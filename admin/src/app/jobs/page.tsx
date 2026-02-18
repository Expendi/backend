"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/header";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listJobs, createJob, cancelJob, processJobs } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("");
  const [formSchedule, setFormSchedule] = useState("");
  const [formPayload, setFormPayload] = useState("{}");
  const [formMaxRetries, setFormMaxRetries] = useState("3");

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listJobs();
      setJobs(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  async function handleCreate() {
    if (!formName.trim() || !formType.trim() || !formSchedule.trim()) return;
    setActionLoading(true);
    try {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(formPayload);
      } catch {
        setError("Invalid JSON in payload field");
        setActionLoading(false);
        return;
      }

      await createJob({
        name: formName.trim(),
        jobType: formType.trim(),
        schedule: formSchedule.trim(),
        payload,
        maxRetries: parseInt(formMaxRetries, 10) || 3,
      });
      setCreateModalOpen(false);
      resetForm();
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create job");
    } finally {
      setActionLoading(false);
    }
  }

  function resetForm() {
    setFormName("");
    setFormType("");
    setFormSchedule("");
    setFormPayload("{}");
    setFormMaxRetries("3");
  }

  async function handleCancel(id: string) {
    setActionLoading(true);
    try {
      await cancelJob(id);
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel job");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleProcess() {
    setActionLoading(true);
    try {
      const result = await processJobs();
      setError(null);
      alert(`Processed ${result.processedCount} job(s)`);
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to process jobs");
    } finally {
      setActionLoading(false);
    }
  }

  const columns: Column<Job>[] = [
    {
      key: "id",
      header: "ID",
      render: (row) => (
        <span className="font-mono text-xs">{row.id.slice(0, 8)}...</span>
      ),
    },
    { key: "name", header: "Name" },
    { key: "jobType", header: "Type" },
    { key: "schedule", header: "Schedule", className: "font-mono text-xs" },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "nextRunAt",
      header: "Next Run",
      render: (row) =>
        row.nextRunAt ? new Date(row.nextRunAt).toLocaleString() : "-",
    },
    {
      key: "lastRunAt",
      header: "Last Run",
      render: (row) =>
        row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : "-",
    },
    {
      key: "retryCount",
      header: "Retries",
      render: (row) => `${row.retryCount}/${row.maxRetries}`,
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end">
          {(row.status === "pending" || row.status === "running") && (
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleCancel(row.id);
              }}
              disabled={actionLoading}
            >
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <Header title="Jobs" description="Manage scheduled jobs">
        <Button variant="outline" onClick={handleProcess} disabled={actionLoading}>
          {actionLoading ? "Processing..." : "Trigger Processing"}
        </Button>
        <Button onClick={() => setCreateModalOpen(true)}>Create Job</Button>
      </Header>

      <div className="p-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Loading jobs...
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={jobs}
            emptyMessage="No jobs found."
          />
        )}
      </div>

      <Modal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        title="Create Job"
        description="Schedule a new job"
      >
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="jobName">Name</Label>
            <Input
              id="jobName"
              placeholder="e.g., daily-rebalance"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jobType">Type</Label>
            <Input
              id="jobType"
              placeholder="e.g., rebalance"
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jobSchedule">Schedule (cron expression)</Label>
            <Input
              id="jobSchedule"
              placeholder="e.g., 0 0 * * *"
              value={formSchedule}
              onChange={(e) => setFormSchedule(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jobPayload">Payload (JSON)</Label>
            <Textarea
              id="jobPayload"
              placeholder='{"key": "value"}'
              value={formPayload}
              onChange={(e) => setFormPayload(e.target.value)}
              className="font-mono text-sm"
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jobRetries">Max Retries</Label>
            <Input
              id="jobRetries"
              type="number"
              value={formMaxRetries}
              onChange={(e) => setFormMaxRetries(e.target.value)}
              min={0}
              max={100}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCreateModalOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                actionLoading ||
                !formName.trim() ||
                !formType.trim() ||
                !formSchedule.trim()
              }
            >
              {actionLoading ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
