// backend/db.js
require("dotenv").config();
const sql = require("mssql");

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  server: "localhost",
  port: 1433,
  options: {
    trustServerCertificate: true,
    encrypt: false
  }
};


const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then((pool) => {
    console.log(" Connected to SQL Server");
    return pool;
  })
  .catch((err) => {
    console.error("Database Connection Failed:", err);
    throw err;
  });

module.exports = poolPromise;
