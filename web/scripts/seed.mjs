// Первичная настройка базы.
//
//   Создать администратора (обязательно для новой базы):
//     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//       node scripts/seed.mjs --admin-login admin --admin-password 'ваш-пароль' --admin-name 'Имя Фамилия'
//
//   Демо-база (локальная или отдельная демо-база на сервере, НЕ боевая):
//     создаёт демо-пользователей и вызывает demo_reset() из supabase/demo/demo.sql
//     node scripts/seed.mjs --demo
//
// Без переменных окружения скрипт берёт адрес и ключ локального Supabase (`supabase status`).

import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const EMAIL_DOMAIN = 'soctaxi.local'

// Учётные записи демо-базы (данные там вымышленные, пароль общеизвестен).
// В боевой базе не использовать.
const DEMO_PASSWORD = 'demo-2026'
// Администратора среди них нет намеренно: пароль демо-пользователей общеизвестен,
// а администратор мог бы сменить чужие пароли и сломать вход в демо.
const DEMO_USERS = [
  { login: 'dispatcher', full_name: 'Диспетчер (демо)', role: 'dispatcher', phone: '+7 940 000-00-02' },
  { login: 'driver1', full_name: 'Астамур Водитель (демо)', role: 'driver', phone: '+7 940 000-00-11' },
  { login: 'driver2', full_name: 'Даур Водитель (демо)', role: 'driver', phone: '+7 940 000-00-12' },
]

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}

function localEnv() {
  try {
    const out = execSync('supabase status -o env', {
      cwd: new URL('../..', import.meta.url),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    const env = {}
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
      if (m) env[m[1]] = m[2]
    }
    return { url: env.API_URL, key: env.SERVICE_ROLE_KEY }
  } catch {
    return {}
  }
}

const fallback = process.env.SUPABASE_URL ? {} : localEnv()
const url = process.env.SUPABASE_URL ?? fallback.url
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fallback.key
if (!url || !key) {
  console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (или запущенный локальный Supabase).')
  process.exit(1)
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

function must({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function ensureUser({ login, password, full_name, role, phone }) {
  const existing = must(
    await db.from('profiles').select('id').eq('login', login).maybeSingle(),
    'profiles',
  )
  if (existing) {
    console.log(`  = ${login} уже есть`)
    return existing.id
  }
  const { data, error } = await db.auth.admin.createUser({
    email: `${login}@${EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`createUser ${login}: ${error.message}`)
  must(
    await db.from('profiles').insert({ id: data.user.id, login, full_name, role, phone: phone ?? null }),
    'insert profile',
  )
  console.log(`  + ${login} (${role})`)
  return data.user.id
}

async function demo() {
  console.log('Пользователи:')
  const ids = {}
  for (const u of DEMO_USERS) ids[u.login] = await ensureUser({ ...u, password: DEMO_PASSWORD })

  // Данные (клиенты, машины, расписание, отказы) создаёт сама база: supabase/demo/demo.sql
  const { error } = await db.rpc('demo_reset')
  if (error) {
    throw new Error(
      `demo_reset: ${error.message}\n` +
        'Сначала примените демо-скрипт к ЭТОЙ (не боевой!) базе, для локальной:\n' +
        '  docker exec -i supabase_db_soctaxi psql -U postgres -d postgres < ../supabase/demo/demo.sql',
    )
  }
  console.log('  + демо-данные загружены')
}

async function main() {
  const adminLogin = arg('admin-login')
  if (adminLogin) {
    const password = arg('admin-password')
    if (typeof password !== 'string' || password.length < 6) {
      throw new Error('Укажите --admin-password (минимум 6 символов)')
    }
    console.log('Администратор:')
    await ensureUser({
      login: String(adminLogin).toLowerCase(),
      password,
      full_name: typeof arg('admin-name') === 'string' ? arg('admin-name') : 'Администратор',
      role: 'admin',
    })
  }
  if (arg('demo')) await demo()
  if (!adminLogin && !arg('demo')) {
    console.log('Нечего делать. Используйте --admin-login/--admin-password или --demo.')
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
