import pg from "pg";
import { config } from "./config.js";
const { Pool } = pg;
export const pool = new Pool({connectionString:config.DATABASE_URL,ssl:config.DATABASE_SSL==="require"?{rejectUnauthorized:true}:undefined,max:10,idleTimeoutMillis:30000,connectionTimeoutMillis:5000});
pool.on("error",(error)=>console.error("Unexpected PostgreSQL pool error",error));
export async function checkDatabase():Promise<void>{await pool.query("SELECT 1");}
