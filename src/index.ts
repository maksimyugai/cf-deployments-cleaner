export interface Env {
	CF_API_TOKEN: string;
	CF_ACCOUNT_ID: string;
	KEEP_PRODUCTION_COUNT: string;
}

interface PagesProject {
	name: string;
}

interface PagesDeployment {
	id: string;
	environment: 'production' | 'preview';
	created_on: string;
	is_skipped?: boolean;
}

interface CfApiResponse<T> {
	success: boolean;
	errors: { code: number; message: string }[];
	result: T;
	result_info?: { page: number; per_page: number; count: number; total_count: number };
}

const API_BASE = 'https://api.cloudflare.com/client/v4';
// Cloudflare's global rate limit is 1200 req / 5 min (~4 req/s). Stay comfortably under it.
const DELETE_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cfFetch<T>(url: string, env: Env, init: RequestInit = {}): Promise<CfApiResponse<T>> {
	const res = await fetch(url, {
		...init,
		headers: {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			'Content-Type': 'application/json',
			...(init.headers ?? {}),
		},
	});
	const body = (await res.json()) as CfApiResponse<T>;
	return body;
}

async function listAllProjects(env: Env): Promise<PagesProject[]> {
	// This endpoint returns all projects in a single response; it does not accept page/per_page.
	const url = `${API_BASE}/accounts/${env.CF_ACCOUNT_ID}/pages/projects`;
	const body = await cfFetch<PagesProject[]>(url, env);
	if (!body.success) {
		throw new Error(`Failed to list projects: ${JSON.stringify(body.errors)}`);
	}
	return body.result;
}

async function listAllDeployments(env: Env, projectName: string): Promise<PagesDeployment[]> {
	const deployments: PagesDeployment[] = [];
	let page = 1;
	for (;;) {
		const url = `${API_BASE}/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${encodeURIComponent(
			projectName,
		)}/deployments?page=${page}&per_page=25`;
		const body = await cfFetch<PagesDeployment[]>(url, env);
		if (!body.success) {
			throw new Error(`Failed to list deployments for ${projectName}: ${JSON.stringify(body.errors)}`);
		}
		deployments.push(...body.result);
		if (body.result.length < 25) break;
		page++;
	}
	return deployments;
}

async function deleteDeployment(env: Env, projectName: string, deploymentId: string): Promise<void> {
	const url = `${API_BASE}/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${encodeURIComponent(
		projectName,
	)}/deployments/${deploymentId}?force=true`;
	const body = await cfFetch<unknown>(url, env, { method: 'DELETE' });
	if (!body.success) {
		const message = body.errors.map((e) => e.message).join('; ');
		// The currently live production deployment can't be deleted - that's expected, skip it.
		if (/active production deployment/i.test(message)) {
			console.log(`  skip ${deploymentId}: ${message}`);
			return;
		}
		throw new Error(`Failed to delete deployment ${deploymentId} for ${projectName}: ${message}`);
	}
	console.log(`  deleted ${deploymentId}`);
}

async function cleanupProject(env: Env, projectName: string, keepProductionCount: number): Promise<void> {
	console.log(`Project: ${projectName}`);
	const deployments = await listAllDeployments(env, projectName);

	const production = deployments
		.filter((d) => d.environment === 'production')
		.sort((a, b) => new Date(b.created_on).getTime() - new Date(a.created_on).getTime());
	const preview = deployments.filter((d) => d.environment === 'preview');

	const productionToDelete = production.slice(keepProductionCount);
	const toDelete = [...productionToDelete, ...preview];

	console.log(
		`  found ${deployments.length} deployments (${production.length} production, ${preview.length} preview); deleting ${toDelete.length}`,
	);

	for (const deployment of toDelete) {
		await deleteDeployment(env, projectName, deployment.id);
		await sleep(DELETE_DELAY_MS);
	}
}

async function runCleanup(env: Env): Promise<void> {
	const keepProductionCount = Number.parseInt(env.KEEP_PRODUCTION_COUNT, 10) || 3;
	const projects = await listAllProjects(env);
	console.log(`Found ${projects.length} Pages project(s)`);

	for (const project of projects) {
		try {
			await cleanupProject(env, project.name, keepProductionCount);
		} catch (err) {
			console.error(`Error cleaning up project ${project.name}:`, err);
		}
	}
}

export default {
	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(runCleanup(env));
	},

	// Manual trigger for local testing (`wrangler dev` + `curl .../__run`), not exposed publicly by default.
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/__run') {
			ctx.waitUntil(runCleanup(env));
			return new Response('Cleanup started, check logs (wrangler tail).\n');
		}
		return new Response('OK');
	},
};
