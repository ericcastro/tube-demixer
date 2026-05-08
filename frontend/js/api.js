const BASE = "/api/projects";

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const getModels   = ()     => request(`${BASE}/models`);
export const getProjects = ()     => request(BASE);
export const getProject  = (id)   => request(`${BASE}/${id}`);
export const createProject = (d)  => request(BASE, { method: "POST", body: JSON.stringify(d) });
export const deleteProject = (id) => request(`${BASE}/${id}`, { method: "DELETE" });
