import {readdir,readFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {pool} from "./db.js";
const migrationsDir=join(fileURLToPath(new URL(".",import.meta.url)),"..","migrations");
async function main(){const client=await pool.connect();let locked=false;try{await client.query("SELECT pg_advisory_lock(734921045)");locked=true;await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);const files=(await readdir(migrationsDir)).filter(n=>n.endsWith(".sql")).sort();for(const filename of files){const exists=await client.query("SELECT 1 FROM public.schema_migrations WHERE filename=$1",[filename]);if(exists.rowCount)continue;const sql=await readFile(join(migrationsDir,filename),"utf8");await client.query("BEGIN");try{await client.query(sql);await client.query("INSERT INTO public.schema_migrations(filename) VALUES($1)",[filename]);await client.query("COMMIT");console.log(`Applied ${filename}`);}catch(error){await client.query("ROLLBACK");throw error;}}}finally{if(locked)await client.query("SELECT pg_advisory_unlock(734921045)").catch(()=>undefined);client.release();await pool.end();}}
main().catch(error=>{console.error("Migration failed",error);process.exit(1);});
