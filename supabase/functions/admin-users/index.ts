// Управление учётными записями сотрудников (водители, диспетчеры, администраторы).
// Вызывать может только активный администратор.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_DOMAIN = "soctaxi.local";
const ROLES = ["admin", "dispatcher", "driver"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Метод не поддерживается", 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) return fail("Требуется вход", 401);
  const callerId = userData.user.id;

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: me } = await admin
    .from("profiles")
    .select("role, is_active")
    .eq("id", callerId)
    .maybeSingle();
  if (!me || !me.is_active || me.role !== "admin") {
    return fail("Доступно только администратору", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Некорректный запрос");
  }

  const action = String(body.action ?? "");

  if (action === "create") {
    const login = String(body.login ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const phone = String(body.phone ?? "").trim() || null;
    const role = String(body.role ?? "");

    if (!/^[a-z0-9._-]{3,32}$/.test(login)) {
      return fail("Логин: 3–32 символа, латинские буквы, цифры, точка, дефис");
    }
    if (password.length < 6) return fail("Пароль — минимум 6 символов");
    if (!fullName) return fail("Укажите имя");
    if (!ROLES.includes(role)) return fail("Неизвестная роль");

    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${login}@${EMAIL_DOMAIN}`,
      password,
      email_confirm: true,
    });
    if (error || !created.user) {
      const taken = /already|registered|exists/i.test(error?.message ?? "");
      return fail(taken ? "Такой логин уже занят" : (error?.message ?? "Не удалось создать"));
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      login,
      full_name: fullName,
      phone,
      role,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return fail(profileError.message);
    }
    return json({ id: created.user.id });
  }

  if (action === "update") {
    const id = String(body.id ?? "");
    if (!id) return fail("Не указан сотрудник");

    const patch: Record<string, unknown> = {};
    if (typeof body.full_name === "string") {
      const name = body.full_name.trim();
      if (!name) return fail("Укажите имя");
      patch.full_name = name;
    }
    if (typeof body.phone === "string") patch.phone = body.phone.trim() || null;
    if (typeof body.role === "string") {
      if (!ROLES.includes(body.role)) return fail("Неизвестная роль");
      if (id === callerId && body.role !== "admin") {
        return fail("Нельзя снять роль администратора с самого себя");
      }
      patch.role = body.role;
    }
    if (typeof body.is_active === "boolean") {
      if (id === callerId && !body.is_active) return fail("Нельзя отключить самого себя");
      patch.is_active = body.is_active;
    }

    const { error } = await admin.from("profiles").update(patch).eq("id", id);
    if (error) return fail(error.message);

    if (typeof body.is_active === "boolean") {
      await admin.auth.admin.updateUserById(id, {
        ban_duration: body.is_active ? "none" : "876000h",
      });
    }
    // Водитель, который перестал быть водителем или отключён, снимается с машины.
    if (patch.is_active === false || (patch.role && patch.role !== "driver")) {
      await admin.from("vehicles").update({ driver_id: null }).eq("driver_id", id);
    }
    return json({ ok: true });
  }

  if (action === "set_password") {
    const id = String(body.id ?? "");
    const password = String(body.password ?? "");
    if (!id) return fail("Не указан сотрудник");
    if (password.length < 6) return fail("Пароль — минимум 6 символов");
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return fail(error.message);
    return json({ ok: true });
  }

  return fail("Неизвестное действие");
});
