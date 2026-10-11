// Uso: node scripts/hash-password.mjs "minha senha"  -> imprime ADMIN_PASSWORD_HASH (scrypt + salt aleatório)
import { randomBytes, scryptSync } from "node:crypto";
const pwd = process.argv[2];
if (!pwd || pwd.length < 10) { console.error("Informe uma senha com 10+ caracteres entre aspas."); process.exit(1); }
const salt = randomBytes(16);
console.log(`ADMIN_PASSWORD_HASH=scrypt:${salt.toString("base64url")}:${scryptSync(pwd, salt, 64).toString("base64url")}`);
