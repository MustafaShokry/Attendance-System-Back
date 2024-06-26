const mysql = require('mysql2/promise');

// Create a connection pool
const pool = mysql.createPool({
  connectionLimit: 10,
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'final',
  port: 3307
});



async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function populateDatabase() {
  try {
    console.log('Populating database...');

    // Insert department data
    await pool.query(`INSERT INTO department (dep_id, dep_name) VALUES (1, 'Computer Engineering')`);
    await pool.query(`INSERT INTO department (dep_id, dep_name) VALUES (2, 'Communication Engineering')`);
    await pool.query(`INSERT INTO department (dep_id, dep_name) VALUES (4, 'Electrical Engineering')`);

    // Insert student data
    await pool.query(`INSERT INTO student (ssn, student_name, na_id, email, st_year, academic_year, dep_id)
                          VALUES (2013072, 'Mostafa Shokry El-Kamel', 200001, 'mostafa1236@feng.bu.edu.eg', 3, 2024, 1)`);
    await pool.query(`INSERT INTO student (ssn, student_name, na_id, email, st_year, academic_year, dep_id)
                          VALUES (2012073, 'Ahmed Sayed Eid', 200002, 'ahmed2354@feng.bu.edu.eg', 2, 2024, 2)`);
    await pool.query(`INSERT INTO student (ssn, student_name, na_id, email, st_year, academic_year, dep_id)
                          VALUES (2012074, 'Ali Mohammed ahmed', 20000321, 'ali2312@feng.bu.edu.eg', 1, 2024, 4)`);

    // Insert instructor data
    await pool.query(`INSERT INTO instructor (ins_id, ins_name, email, na_id, position)
                          VALUES (1, 'Mohammed Ali', 'mohammedali@feng.bu.edu.eg', '10023001', 'Professor')`);
    await pool.query(`INSERT INTO instructor (ins_id, ins_name, email, na_id, position)
                          VALUES (2, 'Ahmed Eid', 'ahmedeid@feng.bu.edu.eg', '10044001', 'Assistant Professor')`);
    // Insert course data
    await pool.query(`INSERT INTO course (co_id, co_name, co_year, co_term, dep_id) VALUES (1, 'Course 1', 3, 1, 1)`);
    await pool.query(`INSERT INTO course (co_id, co_name, co_year, co_term, dep_id) VALUES (2, 'Course 2', 2, 1, 2)`);
    await pool.query(`INSERT INTO course (co_id, co_name, co_year, co_term, dep_id) VALUES (3, 'Course 3', 1, 1, 4)`);

    // Insert course registration data
    await pool.query(`INSERT INTO enroll (ssn, co_id) VALUES (2013072, 1)`);
    await pool.query(`INSERT INTO enroll (ssn, co_id) VALUES (2013072, 2)`);
    await pool.query(`INSERT INTO enroll (ssn, co_id) VALUES (2012073, 2)`);

    // Insert teach data
    await pool.query(`INSERT INTO teach (ins_id, co_id) VALUES (1, 1)`);
    await pool.query(`INSERT INTO teach (ins_id, co_id) VALUES (2, 2)`);
    await pool.query(`INSERT INTO teach (ins_id, co_id) VALUES (2, 3)`);

    // Insert admin data
    await pool.query(`INSERT INTO admin (username, pass) VALUES ('admin1', 'adminpassword1')`);
    await pool.query(`INSERT INTO admin (username, pass) VALUES ('admin2', 'adminpassword2')`);

    await sleep(1000);
    console.log('Database populated.');
  } catch (error) {
    console.error('Error populating database:', error);
  }
}


async function populateCourseSchedule() {
  try {
    console.log('Populating course schedule...');
    // Insert course schedule data
    await pool.query(`INSERT INTO course_schedule (co_id, schedule_date) VALUES (1, '2023-08-04')`);
    await pool.query(`INSERT INTO course_schedule (co_id, schedule_date) VALUES (1, '2023-08-08')`);
    await pool.query(`INSERT INTO course_schedule (co_id, schedule_date) VALUES (1, '2023-08-11')`);
    await pool.query(`INSERT INTO course_schedule (co_id, schedule_date) VALUES (1, '2023-08-20')`);

    await pool.query(`INSERT INTO course_schedule (co_id, schedule_date) VALUES (2, '2023-08-05')`);
    await pool.query(`INSERT INTO course_schedule (co_id, schedule_date) VALUES (2, '2023-08-08')`);
    await pool.query(`INSERT INTO course_schedule (co_id, schedule_date) VALUES (2, '2023-08-12')`);
    await pool.query(`INSERT INTO course_schedule (co_id, schedule_date) VALUES (2, '2023-08-19')`);
    await sleep(1000);
    console.log('Course schedule populated.');
  } catch (error) {
    console.error('Error populating course schedule:', error);
  }
}

async function populateAttendance() {
  try {
    console.log('Populating attendance...');
    // Insert attendance data
    await pool.query(`INSERT INTO attend (ssn, co_id, atten_date) VALUES (2013072, 1, '2023-08-04')`);
    await pool.query(`INSERT INTO attend (ssn, co_id, atten_date) VALUES (2013072, 1, '2023-08-11')`);
    await pool.query(`INSERT INTO attend (ssn, co_id, atten_date) VALUES (2013072, 1, '2023-08-20')`);
    await pool.query(`INSERT INTO attend (ssn, co_id, atten_date) VALUES (2012073, 1, '2023-08-04')`);
    await pool.query(`INSERT INTO attend (ssn, co_id, atten_date) VALUES (2012073, 1, '2023-08-20')`);
    await pool.query(`INSERT INTO attend (ssn, co_id, atten_date) VALUES (2012073, 2, '2023-08-05')`);
    await pool.query(`INSERT INTO attend (ssn, co_id, atten_date) VALUES (2012073, 2, '2023-08-19')`);
    await sleep(1000);
    console.log('Attendance populated.');
  } catch (error) {
    console.error('Error populating attendance:', error);
  }
}

async function main() {
  await populateDatabase();
  await sleep(1000);
  await populateCourseSchedule();
  await sleep(1000);
  await populateAttendance();

  pool.end();
}

// Call the main function to populate the database with delays and loading messages
main();