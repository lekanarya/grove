import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical,
  Plus,
  Edit,
  Trash2,
  Key,
  Copy,
  CheckCircle2,
  Search,
  Filter,
  Loader2,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import dayjs from "dayjs";

interface Apikey {
  id: number;
  name: string;
  key: string;
  created: string;
  status: "active" | "revoked";
  lastUsed?: string;
}

const fetchApikeys = async () => {
  const response = await fetch("/api/apikeys", {
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_PUBLIC_API_KEY}`,
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || `HTTP ${response.status}: Failed to fetch API keys`,
    );
  }
  return response.json();
};

const createApikey = async (newApikey: Apikey) => {
  const response = await fetch("/api/apikeys", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_PUBLIC_API_KEY}`,
    },
    body: JSON.stringify(newApikey),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || `HTTP ${response.status}: Failed to create API key`,
    );
  }
  return response.json();
};

const updateApikey = async (updatedApikey: Apikey) => {
  const response = await fetch(`/api/apikeys/${updatedApikey.key}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_PUBLIC_API_KEY}`,
    },
    body: JSON.stringify(updatedApikey),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || `HTTP ${response.status}: Failed to update API key`,
    );
  }
  return response.json();
};

const deleteApikey = async (key: string) => {
  const response = await fetch(`/api/apikeys/${key}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_PUBLIC_API_KEY}`,
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || `HTTP ${response.status}: Failed to delete API key`,
    );
  }
  return response.json();
};

const toggleApikeyStatus = async (key: string, currentStatus: string) => {
  const endpoint = currentStatus === "active" ? "revoke" : "reactivate";
  const response = await fetch(`/api/apikeys/${key}/${endpoint}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_PUBLIC_API_KEY}`,
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message ||
        `HTTP ${response.status}: Failed to toggle API key status`,
    );
  }
  return response.json();
};

export default function Apikeys() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddApikeyModal, setShowAddApikeyModal] = useState(false);
  const [showEditApikeyModal, setShowEditApikeyModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [currentApikey, setCurrentApikey] = useState<Apikey | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "revoked"
  >("all");
  const [newApikey, setNewApikey] = useState({
    name: "",
  });

  const {
    data: responseData = { data: [] },
    isLoading,
    isError,
    error,
    isFetching,
    isRefetching,
  } = useQuery({
    queryKey: ["apikeys"],
    queryFn: fetchApikeys,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnReconnect: true, // Refetch when network reconnects
    retry: 3, // Retry failed requests 3 times
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
    refetchIntervalInBackground: true, // Keep refreshing in background
  });

  const apikeys = Array.isArray(responseData.data) ? responseData.data : [];

  const createApikeyMutation = useMutation({
    mutationFn: createApikey,
    onMutate: async (newApikey) => {
      await queryClient.cancelQueries({ queryKey: ["apikeys"] });

      const previousData = queryClient.getQueryData(["apikeys"]);

      const tempApikey: Apikey = {
        id: Date.now(),
        name: newApikey.name,
        key: newApikey.key,
        created: new Date().toISOString().split("T")[0],
        status: "active",
      };

      queryClient.setQueryData(["apikeys"], (old: any) => ({
        ...old,
        data: old?.data ? [tempApikey, ...old.data] : [tempApikey],
      }));

      return { previousData };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["apikeys"], (old: any) => ({
        ...old,
        data: old?.data?.map((key: Apikey) =>
          key.id === data.id || String(key.id).startsWith("temp-") ? data : key,
        ) || [data],
      }));
      toast({
        title: "Success",
        description: "API key created successfully",
      });
      handleCloseAddModal();

      queryClient.prefetchQuery({
        queryKey: ["apikeys"],
        queryFn: fetchApikeys,
        staleTime: 0, // Force fresh data
      });
    },
    onError: (error: Error, newApikey, context) => {
      queryClient.setQueryData(["apikeys"], context?.previousData);
      toast({
        title: "Error",
        description: error.message || "Failed to create API key",
        variant: "destructive",
      });
    },
  });

  const updateApikeyMutation = useMutation({
    mutationFn: updateApikey,
    onMutate: async (updatedApikey) => {
      await queryClient.cancelQueries({ queryKey: ["apikeys"] });

      const previousData = queryClient.getQueryData(["apikeys"]);

      queryClient.setQueryData(["apikeys"], (old: any) => ({
        ...old,
        data:
          old?.data?.map((key: Apikey) =>
            key.key === updatedApikey.key ? { ...key, ...updatedApikey } : key,
          ) || [],
      }));

      return { previousData };
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "API key updated successfully",
      });
      handleCloseEditModal();

      queryClient.prefetchQuery({
        queryKey: ["apikeys"],
        queryFn: fetchApikeys,
        staleTime: 0,
      });
    },
    onError: (error: Error, updatedApikey, context) => {
      queryClient.setQueryData(["apikeys"], context?.previousData);
      toast({
        title: "Error",
        description: error.message || "Failed to update API key",
        variant: "destructive",
      });
    },
  });

  const deleteApikeyMutation = useMutation({
    mutationFn: deleteApikey,
    onMutate: async (keyToDelete) => {
      await queryClient.cancelQueries({ queryKey: ["apikeys"] });

      const previousData = queryClient.getQueryData(["apikeys"]);

      queryClient.setQueryData(["apikeys"], (old: any) => ({
        ...old,
        data: old?.data?.filter((key: Apikey) => key.key !== keyToDelete) || [],
      }));

      return { previousData };
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "API key deleted successfully",
      });
      handleCloseDeleteConfirm();

      queryClient.prefetchQuery({
        queryKey: ["apikeys"],
        queryFn: fetchApikeys,
        staleTime: 0,
      });
    },
    onError: (error: Error, keyToDelete, context) => {
      queryClient.setQueryData(["apikeys"], context?.previousData);
      toast({
        title: "Error",
        description: error.message || "Failed to delete API key",
        variant: "destructive",
      });
    },
  });

  // Mutation to toggle API key status
  const toggleApikeyStatusMutation = useMutation({
    mutationFn: ({
      key,
      currentStatus,
    }: {
      key: string;
      currentStatus: string;
    }) => toggleApikeyStatus(key, currentStatus),
    onMutate: async ({ key, currentStatus }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["apikeys"] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData(["apikeys"]);

      // Optimistically toggle the status
      const newStatus = currentStatus === "active" ? "revoked" : "active";
      queryClient.setQueryData(["apikeys"], (old: any) => ({
        ...old,
        data:
          old?.data?.map((apikey: Apikey) =>
            apikey.key === key ? { ...apikey, status: newStatus } : apikey,
          ) || [],
      }));

      return { previousData };
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "API key status updated successfully",
      });
      // Prefetch to update cache with latest data
      queryClient.prefetchQuery({
        queryKey: ["apikeys"],
        queryFn: fetchApikeys,
        staleTime: 0, // Force fresh data
      });
    },
    onError: (error: Error, variables, context) => {
      // If the mutation fails, use the context to roll back
      queryClient.setQueryData(["apikeys"], context?.previousData);
      toast({
        title: "Error",
        description: error.message || "Failed to update API key status",
        variant: "destructive",
      });
    },
  });

  // Handler functions for UI interactions
  const handleShowAddModal = () => setShowAddApikeyModal(true);
  const handleCloseAddModal = () => {
    setShowAddApikeyModal(false);
    setNewApikey({ name: "" });
  };

  const handleShowEditModal = (apikey: Apikey) => {
    setCurrentApikey(apikey);
    setShowEditApikeyModal(true);
  };

  const handleCloseEditModal = () => {
    setShowEditApikeyModal(false);
    setCurrentApikey(null);
  };

  const handleShowDeleteConfirm = (apikey: Apikey) => {
    setCurrentApikey(apikey);
    setShowDeleteConfirm(true);
  };

  const handleCloseDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setCurrentApikey(null);
  };

  const handleAddApikey = () => {
    if (!newApikey.name.trim()) return;
    const newKey: Apikey = {
      id:
        apikeys.length > 0
          ? Math.max(...apikeys.map((u: Apikey) => u.id)) + 1
          : 1,
      name: newApikey.name,
      key: `sk_${Math.random().toString(36).substring(2, 20)}${Math.random().toString(36).substring(2, 15)}`,
      created: new Date().toISOString().split("T")[0],
      status: "active",
    };
    createApikeyMutation.mutate(newKey);
  };

  const handleEditApikey = () => {
    if (!currentApikey?.name.trim()) return;
    updateApikeyMutation.mutate(currentApikey);
  };

  const handleDeleteApikey = () => {
    if (!currentApikey) return;
    deleteApikeyMutation.mutate(currentApikey.key);
  };

  const handleRevokeToggle = (key: string, currentStatus: string) => {
    toggleApikeyStatusMutation.mutate({ key, currentStatus });
  };

  const handleCopyKey = (key: string, id: number) => {
    navigator.clipboard.writeText(key);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const filteredApikeys = apikeys.filter((api: Apikey) => {
    const matchesSearch =
      api.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      api.key?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || api.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (isLoading) {
    return (
      <AdminLayout title="API Keys">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (isError) {
    return (
      <AdminLayout title="API Keys">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-500">Failed to load API keys</p>
            <Button
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: ["apikeys"] })
              }
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="API Keys">
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
              {isFetching && !isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              Manage your application's API keys and access
              {isRefetching && " • Syncing..."}
            </p>
          </div>
          <Button onClick={handleShowAddModal} className="gap-2">
            <Plus className="h-4 w-4" />
            Add API Key
          </Button>
        </div>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search keys..."
                  className="pl-8 w-full sm:w-[300px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <Filter className="h-4 w-4" />
                      {statusFilter === "all" ? "All Status" : statusFilter}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setStatusFilter("all")}>
                      All Status
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setStatusFilter("active")}>
                      Active
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setStatusFilter("revoked")}
                    >
                      Revoked
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredApikeys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No API keys found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredApikeys.map((apikey: Apikey) => (
                    <TableRow key={apikey.id}>
                      <TableCell className="font-medium">
                        {apikey.name}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold">
                            {apikey.key.substring(0, 10)}...
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopyKey(apikey.key, apikey.id)}
                            className="h-8 w-8"
                          >
                            {copiedKeyId === apikey.id ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        {dayjs(apikey.created).format("MMM DD, YYYY")}
                      </TableCell>
                      <TableCell>
                        {apikey.lastUsed
                          ? dayjs(apikey.lastUsed).format(
                              "MMM DD, YYYY @ hh:mm A",
                            )
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            apikey.status === "active" ? "default" : "secondary"
                          }
                          className={
                            apikey.status === "active"
                              ? "bg-admin-green-100 text-green-800 hover:bg-admin-green-100"
                              : ""
                          }
                        >
                          {apikey.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleShowEditModal(apikey)}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                handleRevokeToggle(apikey.key, apikey.status)
                              }
                              disabled={toggleApikeyStatusMutation.isPending}
                            >
                              {toggleApikeyStatusMutation.isPending ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  {apikey.status === "active"
                                    ? "Revoking..."
                                    : "Activating..."}
                                </>
                              ) : (
                                <>
                                  <Key className="mr-2 h-4 w-4" />
                                  {apikey.status === "active"
                                    ? "Revoke"
                                    : "Activate"}
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => handleShowDeleteConfirm(apikey)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Add API Key Modal */}
        <Dialog open={showAddApikeyModal} onOpenChange={setShowAddApikeyModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Add New API Key
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Key Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Production Server"
                  value={newApikey.name}
                  onChange={(e) =>
                    setNewApikey({ ...newApikey, name: e.target.value })
                  }
                />
                <p className="text-sm text-muted-foreground">
                  Give your key a descriptive name to identify its purpose.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseAddModal}>
                Cancel
              </Button>
              <Button
                onClick={handleAddApikey}
                disabled={
                  !newApikey.name.trim() || createApikeyMutation.isPending
                }
              >
                {createApikeyMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create API Key
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit API Key Modal */}
        <Dialog
          open={showEditApikeyModal}
          onOpenChange={setShowEditApikeyModal}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit API Key</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Key Name</Label>
                <Input
                  id="edit-name"
                  value={currentApikey?.name || ""}
                  onChange={(e) =>
                    setCurrentApikey({
                      ...currentApikey,
                      name: e.target.value,
                    } as Apikey)
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseEditModal}>
                Cancel
              </Button>
              <Button
                onClick={handleEditApikey}
                disabled={
                  !currentApikey?.name?.trim() || updateApikeyMutation.isPending
                }
              >
                {updateApikeyMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you sure?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. This will permanently delete the
                API key
                <span className="font-medium"> {currentApikey?.name}</span> and
                revoke all access.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseDeleteConfirm}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteApikey}
                disabled={deleteApikeyMutation.isPending}
              >
                {deleteApikeyMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Delete API Key
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
