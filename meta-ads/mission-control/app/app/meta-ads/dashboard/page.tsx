// The same dashboard at /app/meta-ads/dashboard. The installer never
// overwrites an existing file, so a Mission Control that already had its own
// /app/meta-ads page keeps it and gets the owner dashboard at this address.
import Dashboard from "../components/Dashboard";

export default function MetaAdsDashboardPage() {
  return <Dashboard />;
}
