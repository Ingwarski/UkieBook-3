import { readRuntimeIdentity } from "../../../modules/platform/runtime-identity";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      service: "ukiebook-web",
      status: "ok",
      unit: "UNIT-00",
      ...readRuntimeIdentity("web"),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
