export {};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing deployment secret: ${name}`);
  }
  if (value !== value.trim()) {
    throw new Error(
      `${name} contains surrounding whitespace; save its exact value in GitHub Secrets`,
    );
  }
  return value;
}

const token = required('VERCEL_TOKEN');
const teamId = required('VERCEL_ORG_ID');
const projectId = required('VERCEL_PROJECT_ID');

if (!/^team_[A-Za-z0-9]+$/.test(teamId) || !/^prj_[A-Za-z0-9]+$/.test(projectId)) {
  throw new Error(
    'Use the team_ orgId and prj_ projectId from .vercel/project.json, not names or URLs',
  );
}

async function access(path: string, resource: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const reason =
      response.status === 401
        ? 'The token was rejected. Replace VERCEL_TOKEN with a valid, unexpired Vercel access token.'
        : response.status === 403
          ? 'The CI token cannot access this project. Check its project scope and the configured IDs.'
          : response.status === 404
            ? 'The project is not visible to this token. Check both IDs and the token project scope.'
            : 'Check Vercel service availability and retry.';
    throw new Error(`Vercel ${resource} access failed (HTTP ${response.status}). ${reason}`);
  }
  return response.json();
}

const project = await access(
  `/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(teamId)}`,
  'project',
);
if (project.id !== projectId || project.accountId !== teamId) {
  throw new Error('Vercel project and owner do not match the configured IDs');
}

console.log(`Vercel project access verified for ${String(project.name)}.`);
