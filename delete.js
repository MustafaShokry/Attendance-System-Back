const mysql = require('mysql2/promise');

// Create a connection pool
const pool = mysql.createPool({
    connectionLimit: 10,
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'final',
    port: 3306
});

// List of tables in the database
const tables = [
  'absent_days',
  'pending_warnings',
  'attend',
  'enroll',
  'teach',
  'course_schedule',
  'warnings',
  'pending_ill_reports',
  'historical_student_records',
  'historical_course_records',
  'studentssn_history',
  'course',
  'instructor',
  'student',
  'department',
  'admin', 
];

async function deleteDataFromTables() {
  try {
    // Delete data from each table in the appropriate order
    for (const table of tables) {
      await pool.query(`DELETE FROM ${table}`);
      console.log(`Deleted data from ${table}`);
    }
    console.log('All data deleted successfully.');
  } catch (error) {
    console.error('Error deleting data:', error);
  } finally {
    pool.end();
  }
}

deleteDataFromTables();
