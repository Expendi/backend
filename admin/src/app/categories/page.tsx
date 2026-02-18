"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/header";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/api";
import type { TransactionCategory } from "@/lib/types";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TransactionCategory | null>(null);

  const [formName, setFormName] = useState("");
  const [formUserId, setFormUserId] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listCategories();
      setCategories(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  function resetForm() {
    setFormName("");
    setFormUserId("");
    setFormDescription("");
  }

  async function handleCreate() {
    if (!formName.trim()) return;
    setActionLoading(true);
    try {
      await createCategory({
        name: formName.trim(),
        userId: formUserId.trim() || undefined,
        description: formDescription.trim() || undefined,
      });
      setCreateModalOpen(false);
      resetForm();
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create category");
    } finally {
      setActionLoading(false);
    }
  }

  function openEdit(cat: TransactionCategory) {
    setEditTarget(cat);
    setFormName(cat.name);
    setFormDescription(cat.description ?? "");
    setEditModalOpen(true);
  }

  async function handleUpdate() {
    if (!editTarget || !formName.trim()) return;
    setActionLoading(true);
    try {
      await updateCategory(editTarget.id, {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
      });
      setEditModalOpen(false);
      setEditTarget(null);
      resetForm();
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update category");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this category?")) return;
    setActionLoading(true);
    try {
      await deleteCategory(id);
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete category");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div>
      <Header title="Categories" description="Manage transaction categories">
        <Button onClick={() => { resetForm(); setCreateModalOpen(true); }}>
          Create Category
        </Button>
      </Header>

      <div className="p-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Loading categories...
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No categories found.
                    </TableCell>
                  </TableRow>
                ) : (
                  categories.map((cat) => (
                    <TableRow key={cat.id}>
                      <TableCell className="font-mono text-xs">
                        {cat.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell className="font-medium">{cat.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {cat.userId ?? "system"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {cat.description ?? "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(cat.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(cat)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(cat.id)}
                            disabled={actionLoading}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Modal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        title="Create Category"
        description="Add a new transaction category"
      >
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="catName">Name</Label>
            <Input
              id="catName"
              placeholder="e.g., DeFi Swap"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catUserId">User ID (optional, leave empty for system category)</Label>
            <Input
              id="catUserId"
              placeholder="e.g., did:privy:..."
              value={formUserId}
              onChange={(e) => setFormUserId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catDesc">Description</Label>
            <Textarea
              id="catDesc"
              placeholder="What is this category for?"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={actionLoading || !formName.trim()}
            >
              {actionLoading ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        title="Edit Category"
        description={`Editing: ${editTarget?.name ?? ""}`}
      >
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="editCatName">Name</Label>
            <Input
              id="editCatName"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editCatDesc">Description</Label>
            <Textarea
              id="editCatDesc"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={actionLoading || !formName.trim()}
            >
              {actionLoading ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
