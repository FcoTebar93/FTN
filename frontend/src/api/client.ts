import { API_BASE_URL } from "../config";

export async function fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`);

    if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}, message: ${res.statusText}`);
    }
    return res.json() as Promise<T>;
}