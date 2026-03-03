import { supabase } from "../client";
import type { Agent } from "../types";

export async function getActiveAgents(): Promise<Agent[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("is_active", true)
    .eq("is_frontlines", false);

  if (error) throw error;
  return data;
}

export async function getFrontlinesAgent(): Promise<Agent | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("is_frontlines", true)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getAgentByPhone(phone: string): Promise<Agent | null> {
  // Normalize phone: strip all non-digits, compare last 10
  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);

  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("is_active", true);

  if (error) throw error;

  return (
    data.find(
      (agent) => agent.phone.replace(/\D/g, "").slice(-10) === normalizedPhone
    ) ?? null
  );
}

export async function getAgentById(id: string): Promise<Agent | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", id)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function updateAgent(
  id: string,
  updates: Partial<Omit<Agent, "id" | "created_at" | "updated_at">>
) {
  const { data, error } = await supabase
    .from("agents")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createAgent(
  agent: Omit<Agent, "id" | "created_at" | "updated_at">
) {
  const { data, error } = await supabase
    .from("agents")
    .insert(agent)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getAllAgents(): Promise<Agent[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("name");

  if (error) throw error;
  return data;
}
