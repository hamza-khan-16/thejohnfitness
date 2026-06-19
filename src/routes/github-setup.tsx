import { createFileRoute, redirect } from "@tanstack/react-router";

// Unused route — redirect to home
export const Route = createFileRoute("/github-setup")({
  beforeLoad: () => { throw redirect({ to: "/" }); },
  component: () => null,
});
