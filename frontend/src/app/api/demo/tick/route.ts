export async function POST() {
  const backendUrl = stripTrailingSlash(process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000");
  const adminKey = process.env.PRIVALEND_BACKEND_ADMIN_KEY;

  if (!adminKey) {
    return Response.json({ error: "PRIVALEND_BACKEND_ADMIN_KEY is not configured" }, { status: 500 });
  }

  const response = await fetch(`${backendUrl}/admin/tick`, {
    method: "POST",
    headers: { "x-admin-key": adminKey },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  return Response.json(data, { status: response.status });
}

function stripTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
