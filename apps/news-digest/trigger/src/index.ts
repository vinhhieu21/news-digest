// scheduled() = start the news-digest GitHub Actions workflow on time.
// Secret: GITHUB_TOKEN, a fine-grained PAT on this repo with "Actions: read and write".

const ATTEMPTS = 3;

export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller, env): Promise<void> {
    await dispatchWorkflow(env);
  },
} satisfies ExportedHandler<Env>;

export async function dispatchWorkflow(env: Env, backoffMs = 2000): Promise<void> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "news-digest-trigger",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: env.GITHUB_REF }),
  };

  // Throwing marks the cron invocation as failed in Workers observability.
  for (let attempt = 1; ; attempt++) {
    let error: string;
    try {
      const res = await fetch(url, init);
      if (res.ok) {
        console.log(`dispatched ${env.GITHUB_WORKFLOW}@${env.GITHUB_REF}`);
        return;
      }
      error = `GitHub ${res.status}: ${await res.text()}`;
      // Other 4xx (bad token, missing permission, unknown ref) won't fix themselves.
      if (res.status < 500 && res.status !== 429) throw new Error(error);
    } catch (err) {
      if (!(err instanceof TypeError)) throw err; // TypeError = network failure
      error = String(err);
    }
    if (attempt >= ATTEMPTS) throw new Error(`dispatch failed after ${ATTEMPTS} attempts: ${error}`);
    console.warn(`dispatch attempt ${attempt} failed, retrying: ${error}`);
    await scheduler.wait(backoffMs * 2 ** (attempt - 1));
  }
}
