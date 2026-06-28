import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function AccessDenied({ title = "Access denied", message = "You do not have permission to view this page." }: {
  title?: string;
  message?: string;
}) {
  return (
    <AppShell title={title}>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Ask an admin to update your role if you need access.
        </CardContent>
      </Card>
    </AppShell>
  );
}
