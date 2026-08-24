import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { examService } from "../services/examService";
import AppLayout from "../components/AppLayout";
import PageHeader from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import Card, { CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Input, Select, Textarea } from "../components/ui/Input";

/**
 * Step 1 of collaborative exam creation: spin up a shared draft shell.
 * Only a name (+ optional round/category and description) is required here.
 * Timing is collected later, at publish time, inside the draft workspace.
 */
const CreateExam = () => {
  const { getAuthToken } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [examCategory, setExamCategory] = useState("Aptitude");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Give the mock test a name first.");
      return;
    }
    try {
      setSubmitting(true);
      const token = await getAuthToken();
      const res = await examService.createExam(token, {
        title: title.trim(),
        description,
        examCategory,
      });
      navigate(`/edit-exam/${res.exam._id}`);
    } catch (err) {
      setError("Error creating: " + (err.response?.data?.message || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout maxWidth="max-w-3xl">
      <PageHeader
        title="Create New Mock Test"
        subtitle={
          "Name it and save — the draft is instantly visible to your whole training team, who can then add questions in parallel. Schedule & duration are set when you publish."
        }
      />

      {error && (
        <Alert variant="error" className="mt-5">
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Test Details</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4 pt-0">
            <Input
              id="exam-title"
              label="Mock Test Name *"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "Gridlex Mock Test 1 — Aptitude"'
              autoFocus
              required
            />
            <Select
              id="exam-category"
              label="Round"
              value={examCategory}
              onChange={(e) => setExamCategory(e.target.value)}
            >
              <option value="Aptitude">Aptitude</option>
              <option value="Technical">Technical</option>
              <option value="Coding">Coding</option>
              <option value="Mixed">Mixed</option>
            </Select>
            <Textarea
              id="exam-description"
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief notes for the team building this test"
              rows={2}
            />
          </CardBody>
        </Card>

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={() => navigate("/dashboard")}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create Draft"}
          </Button>
        </div>
      </form>
    </AppLayout>
  );
};

export default CreateExam;
