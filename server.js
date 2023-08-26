const express = require("express");
const xlsx = require('xlsx');
const mysql = require("mysql2");
const mysqlPromise = require('mysql2/promise');
const fs = require('fs');
const { promisify } = require('util');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const cors = require('cors');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
const port = 3000;

// Middleware to parse JSON data in requests
app.use(express.json());
app.use(bodyParser.json());
app.use(cors());

// Create a transporter using SMTP
const transporter = nodemailer.createTransport({
  service: 'Gmail', // Replace with your email service
  auth: {
    user: 'mostafashokry2121@gmail.com',
    pass: 'jkjofkafmsxmspyr'
  }
});

const dbConfig = {
  connectionLimit: 10,
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'final',
  port: 3306
};
// Create connection pools
const poolPromise = mysqlPromise.createPool(dbConfig);
const pool = mysql.createPool(dbConfig);
// Define thresholds for warnings
const firstWarningThreshold = 1;
const secondWarningThreshold = 2;
const suspendedThreshold = 3;






async function readExcelFile(filePath, sheetName) {
  const readFileAsync = promisify(fs.readFile);
  try {
    const fileData = await readFileAsync(filePath);
    const workbook = xlsx.read(fileData, { type: 'buffer' });
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found in the Excel file.`);
    }

    const data = xlsx.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      console.log('No data found in the specified sheet.');
    } else {
      return data;
    }
  } catch (err) {
    console.error('Error occurred while reading the Excel file:', err.message);
    throw err;
  }
}


async function insertData(tableName, data) {
  const query = `INSERT INTO ${tableName} SET ?`;

  const getConnection = () => {
    return new Promise((resolve, reject) => {
      pool.getConnection((error, connection) => {
        if (error) reject(error);
        resolve(connection);
      });
    });
  };

  const releaseConnection = (connection) => {
    connection.release();
  };

  for (const item of data) {
    const connection = await getConnection();

    try {
      const result = await new Promise((resolve, reject) => {
        connection.query(query, item, (error, results) => {
          if (error) {
            // Check if the error is a duplicate key error (error code 1062)
            if (error.code === 'ER_DUP_ENTRY') {
              console.warn(`Duplicate entry in ${tableName}:`, error.message);
              resolve({ affectedRows: 0 }); // Resolve with 0 affected rows for duplicate entry
            } else {
              reject(error);
            }
          } else {
            resolve(results);
          }
        });
      });

      if (result.affectedRows > 0) {
        console.log(`Inserted into ${tableName}`);
      } else {
        console.log(`Skipped duplicate entry in ${tableName}`);
      }
    } catch (error) {
      console.error(`Error inserting into ${tableName}:`, error);
    } finally {
      releaseConnection(connection);
    }
  }
}

function GetCourseIdByInstructorId(insId) {
  const tableName = 'teach';
  
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        console.error('Error getting connection:', err.message);
        reject(err);
        return;
      }
      const query = 'SELECT Co_id FROM ?? WHERE Ins_id = ?';
      connection.query(query, [tableName, insId], (err, results) => {
        connection.release();
        if (err) {
          console.error('Error searching for course ID:', err);
          reject(err);
        } else {
          if (results.length > 0) {
            const courseId = results[0].Co_id;
            //console.log('Course ID for instructor ID ' + insId + ':', courseId);
            resolve(courseId);
          } else {
            console.log('No course found for instructor ID:', insId);
            resolve(null);
          }
        }
      });
    });
  });
}

function processData(rawData, Co_id) {
  const ins_id = Object.keys(rawData[0])[0];

  const currentDate = new Date();
  const formattedDate = currentDate.toISOString().slice(0, 10);

  const data = rawData.map((object) => {
    const newObj = {
      ssn: object[ins_id],
      co_id: Co_id,
      atten_date: formattedDate,
    };
    return newObj;
  });
  return data;
}

async function processDataWithCourseId() {
  try {
    const data = await readExcelFile('09-50.csv', 'Sheet1');
    const ins_id = Object.keys(data[0])[0];
    const Co_id = await GetCourseIdByInstructorId(ins_id);

    // Check if the record already exists in the course_schedule table
    const [scheduleResult] = await pool.promise().query(
      'SELECT co_id FROM course_schedule WHERE co_id = ? AND schedule_date = ?',
      [Co_id, new Date().toISOString().slice(0, 10)]
    );

    if (scheduleResult.length === 0) {
      // Insert the schedule record into the course_schedule table
      await pool.promise().query(
        'INSERT INTO course_schedule (co_id, schedule_date) VALUES (?, ?)',
        [Co_id, new Date().toISOString().slice(0, 10)]
      );
    }

    const result = processData(data, Co_id);
    await insertData('attend', result);
  } catch (error) {
    console.error('Error processing data:', error);
  }
}


async function getStudentsEnrolledInCourse(courseId) {
  try {
    const [students] = await poolPromise.query(
      `SELECT s.ssn, s.student_name, s.na_id, s.email, s.st_year, s.dep_id
      FROM student s
      INNER JOIN enroll e ON s.ssn = e.ssn
      WHERE e.co_id = ?`,
      [courseId]
    );

    return students;
  } catch (error) {
    console.error('Error fetching enrolled students:', error);
    throw error;
  }
}


function formatDate(dbDateString) {
  const dbDate = new Date(dbDateString);

  const year = dbDate.getFullYear();
  const month = String(dbDate.getMonth() + 1).padStart(2, '0');
  const day = String(dbDate.getDate()).padStart(2, '0');

  const formattedDate = `${year}-${month}-${day}`;
  return formattedDate;
}

async function getAttendanceByStudentAndCourse(studentId, courseId) {
  try {
    // Step 1: Fetch course dates from the course_schedule table
    const [courseDates] = await poolPromise.execute(
      'SELECT schedule_date FROM course_schedule WHERE co_id = ?',
      [courseId]
    );
    const attendanceDates = courseDates.map((row) => 
    {
      const formattedDate = formatDate(row.schedule_date);
      return formattedDate;
    });

    // Step 2: Fetch the attendance records for the student and course
    const [attendance] = await poolPromise.query(
      'SELECT atten_date FROM attend WHERE ssn = ? AND co_id = ?',
      [studentId, courseId]
    );
    const studentAttendance = attendance.map((row) => {
      const formattedDate = formatDate(row.atten_date);
      return formattedDate;
    });

    // Step 3: Identify the absent dates
    const absentDates = attendanceDates.filter((attendanceDate) => {
      return !studentAttendance.some(
        (studentAttendanceDate) => studentAttendanceDate === attendanceDate
      );
    });

    return {
      courseDates: attendanceDates,
      studentAttendance: studentAttendance,
      absentDates: absentDates,
    };

  } catch (error) {
    throw new Error('Error fetching data from the database: ' + error.message);
  }
}


function mergeAttendanceData(attendanceData) {
  try {
    const { courseDates, studentAttendance, absentDates } = attendanceData;
    const attendanceMap = new Map();

    // Initialize the attendance map with default value of false
    courseDates.forEach((date) => {
      attendanceMap.set(date, false);
    });

    // Mark the dates where the student attended as true
    studentAttendance.forEach((attendance) => {
      // Update the attendanceMap if the date exists
      if (attendanceMap.has(attendance)) {
        attendanceMap.set(attendance, true);
      } else {
        console.error(`Date ${attendance} not found in courseDates.`);
      }
    });

    // Create an array of objects with date and attendance status
    const mergedData = courseDates.map((date) => {
      return {
        date,
        attended: attendanceMap.get(date),
      };
    });

    return mergedData;

  } catch (error) {
    console.error('Error merging attendance data:', error);
    return [];
  }
}

async function getAttendanceForAllStudentsInCourse(courseId) {
  try {
    const studentsEnrolled = await getStudentsEnrolledInCourse(courseId);

    const attendanceDataPromises = studentsEnrolled.map(async (student) => {
      const studentId = student.ssn;
      const attendanceData = await getAttendanceByStudentAndCourse(studentId, courseId);
      const mergedAttendanceData = mergeAttendanceData(attendanceData);

      return {
        student: {
          ssn: student.ssn,
          student_name: student.student_name,
          na_id: student.na_id,
          email: student.email,
          st_year: student.st_year,
          dep_id: student.dep_id,
        },
        attendance: mergedAttendanceData,
      };
    });

    const attendanceForAllStudents = await Promise.all(attendanceDataPromises);
    return attendanceForAllStudents;
  } catch (error) {
    console.error('Error fetching attendance data for all students:', error);
    throw error;
  }
}

// Function to update attendance records for a course
async function updateAttendance(studentList, courseId) {
  try {
    const updatedStudentList = [];

    for (const studentAttendance of studentList) {
      const student = studentAttendance.student;
      const attendance = studentAttendance.attendance;
      const updatedAttendance = [];

      for (const record of attendance) {
        const { date, attended } = record;

        // Check if the attendance record exists in the 'attend' table
        const [existingRecord] = await poolPromise.query(
          'SELECT * FROM attend WHERE ssn = ? AND co_id = ? AND atten_date = ?',
          [student.ssn, courseId, date]
        );

        if (existingRecord.length > 0) {
          if (!attended) {
            // If the record exists and 'attended' is false, delete it
            await poolPromise.query(
              'DELETE FROM attend WHERE ssn = ? AND co_id = ? AND atten_date = ?',
              [student.ssn, courseId, date]
            );
          }
          // Keep the original "attended" status
          updatedAttendance.push({ date, attended });
        } else if (attended) {
          // If the record doesn't exist and 'attended' is true, add it
          await poolPromise.query(
            'INSERT INTO attend (ssn, co_id, atten_date) VALUES (?, ?, ?)',
            [student.ssn, courseId, date]
          );
          updatedAttendance.push({ date, attended });
        } else {
          // If the record doesn't exist and 'attended' is false, keep it as is
          updatedAttendance.push({ date, attended });
        }
      }

      // Update the student's attendance records
      updatedStudentList.push({
        student,
        attendance: updatedAttendance,
      });
    }

    return updatedStudentList;
  } catch (error) {
    throw error;
  }
}



async function getAttendanceSummaryByStudent(studentId) {
  try {
    const [courses] = await poolPromise.query(
      `SELECT c.co_id, c.co_name
      FROM course c
      INNER JOIN enroll e ON c.co_id = e.co_id
      WHERE e.ssn = ?`,
      [studentId]
    );

    const attendanceSummary = [];

    for (const course of courses) {
      const courseId = course.co_id;

      const [courseDates] = await poolPromise.query(
        `SELECT schedule_date
        FROM course_schedule
        WHERE co_id = ?`,
        [courseId]
      );

      const [attendanceData] = await poolPromise.query(
        `SELECT atten_date
        FROM attend
        WHERE ssn = ? AND co_id = ?`,
        [studentId, courseId]
      );

      const attendedDates = attendanceData.map((row) => row.atten_date);
      const totalDates = courseDates.map((row) => row.schedule_date);

      attendanceSummary.push({
        co_id: courseId,
        co_name: course.co_name,
        total_attended: attendedDates.length,
        total_absent: totalDates.length - attendedDates.length
      });
    }

    return attendanceSummary;
  } catch (error) {
    throw new Error('Error fetching attendance summary data: ' + error.message);
  }
}

// Helper function to map database warning state to human-readable format
function mapWarningStateToReadable(state) {
  let warningType = '';
  let num_absent = 0;

  if (state === 'first_warning') {
    warningType = 'First Warning';
    num_absent = firstWarningThreshold;
  } else if (state === 'second_warning') {
    warningType = 'Second Warning';
    num_absent = secondWarningThreshold;
  } else if (state === 'suspended') {
    warningType = 'Suspension';
    num_absent = suspendedThreshold;
  }

  return {
    warningType: warningType,
    num_absent: num_absent,
  };
}

// Function to get the summary for a student
async function getSummaryForStudent(studentId) {
  try {
    const [courses] = await poolPromise.query(
      `SELECT c.co_id, c.co_name
      FROM course c
      INNER JOIN enroll e ON c.co_id = e.co_id
      WHERE e.ssn = ?`,
      [studentId]
    );

    const Summary = [];

    for (const course of courses) {
      const courseId = course.co_id;

      const [courseDates] = await poolPromise.query(
        `SELECT schedule_date
        FROM course_schedule
        WHERE co_id = ?`,
        [courseId]
      );

      const [attendanceData] = await poolPromise.query(
        `SELECT atten_date
        FROM attend
        WHERE ssn = ? AND co_id = ?`,
        [studentId, courseId]
      );

      const attendedDates = attendanceData.map((row) => row.atten_date);
      const totalDates = courseDates.map((row) => row.schedule_date);

      // Check if the student has a warning for this course
      const [warnings] = await poolPromise.query(
        `SELECT state
        FROM warnings
        WHERE ssn = ? AND co_id = ?`,
        [studentId, courseId]
      );

      // Check if the student has a pending warning for this course
      const [pendingWarnings] = await poolPromise.query(
        `SELECT state
        FROM pending_warnings
        WHERE ssn = ? AND co_id = ?`,
        [studentId, courseId]
      );

      // Determine the status based on warnings and pending warnings
      let status = 'OK';
      if (warnings.length > 0) {
        const warningInfo = mapWarningStateToReadable(warnings[0].state);
        status = warningInfo.warningType;
      } else if (pendingWarnings.length > 0) {
        const pendingWarningInfo = mapWarningStateToReadable(pendingWarnings[0].state);
        status = 'Pending ' + pendingWarningInfo.warningType;
      }

      Summary.push({
        co_id: courseId,
        co_name: course.co_name,
        total_attended: attendedDates.length,
        total_absent: totalDates.length - attendedDates.length,
        status: status,
      });
    }

    return Summary;
  } catch (error) {
    throw new Error('Error fetching attendance summary data: ' + error.message);
  }
}

// Function to get the summary for an instructor
async function getInstructorSummary(instructorId) {
  try {
    // Query to fetch instructor name and position
    const [instructorData] = await poolPromise.query(
      'SELECT ins_name, position, email FROM instructor WHERE ins_id = ?',
      [instructorId]
    );

    if (instructorData.length === 0) {
      throw new Error('Instructor not found');
    }

    const instructorName = instructorData[0].ins_name;
    const instructorPosition = instructorData[0].position;
    const instructorEmail = instructorData[0].email;

    // Query to fetch the number of courses taught by the instructor
    const [coursesTaught] = await poolPromise.query(
      'SELECT COUNT(*) AS courseCount FROM teach WHERE ins_id = ?',
      [instructorId]
    );

    const numberOfCoursesTaught = coursesTaught[0].courseCount;

    // Query to fetch the number of suspended students in the courses taught by the instructor
    const [suspendedStudents] = await poolPromise.query(
      `SELECT COUNT(DISTINCT e.ssn) AS suspendedCount
      FROM enroll e
      INNER JOIN warnings w ON e.ssn = w.ssn
      WHERE e.co_id IN (SELECT co_id FROM teach WHERE ins_id = ?)
      AND w.state = 'suspended'`,
      [instructorId]
    );

    const numberOfSuspendedStudents = suspendedStudents[0].suspendedCount;

    return {
      instructorName: instructorName,
      instructorEmail: instructorEmail,
      instructorPosition: instructorPosition,
      numberOfCoursesTaught: numberOfCoursesTaught,
      numberOfSuspendedStudents: numberOfSuspendedStudents,
    };
  } catch (error) {
    throw error;
  }
}

// Function to get the course information for an instructor
async function getCoursesInfoForInstructor(instructorId) {
  try {
    const [courses] = await poolPromise.query(
      `SELECT c.co_id, c.co_name
      FROM course c
      INNER JOIN teach t ON c.co_id = t.co_id
      WHERE t.ins_id = ?`,
      [instructorId]
    );

    const coursesInfo = [];

    for (const course of courses) {
      const courseId = course.co_id;

      const [enrolledStudents] = await poolPromise.query(
        `SELECT e.ssn
        FROM enroll e
        WHERE e.co_id = ?`,
        [courseId]
      );

      const [suspendedStudents] = await poolPromise.query(
        `SELECT w.ssn
        FROM warnings w
        WHERE w.co_id = ? AND w.state = 'suspended'`,
        [courseId]
      );

      coursesInfo.push({
        co_id: courseId,
        co_name: course.co_name,
        numStudents: enrolledStudents.length,
        numSuspendedStudents: suspendedStudents.length,
      });
    }

    return coursesInfo;
  } catch (error) {
    throw new Error('Error fetching courses information for instructor: ' + error.message);
  }
}



async function getAttendanceSummaryByCourse(courseId) {
  try {
    const [students] = await poolPromise.query(
      `SELECT s.ssn, s.student_name, s.email
      FROM student s
      INNER JOIN enroll e ON s.ssn = e.ssn
      WHERE e.co_id = ?`,
      [courseId]
    );

    const [courseDates] = await poolPromise.query(
      `SELECT schedule_date
      FROM course_schedule
      WHERE co_id = ?`,
      [courseId]
    );

    const attendanceSummary = [];

    for (const student of students) {
      const studentId = student.ssn;

      const [attendanceData] = await poolPromise.query(
        `SELECT atten_date
        FROM attend
        WHERE ssn = ? AND co_id = ?`,
        [studentId, courseId]
      );

      const attendedDates = attendanceData.map((row) => row.atten_date);
      const totalDates = courseDates.map((row) => row.schedule_date);

      attendanceSummary.push({
        ssn: studentId,
        student_name: student.student_name,
        email: student.email,
        total_attended: attendedDates.length,
        total_absent: totalDates.length - attendedDates.length
      });
    }

    return attendanceSummary;
  } catch (error) {
    throw new Error('Error fetching attendance summary data: ' + error.message);
  }
}

async function getOverallAttendanceReport() {
  try {
    const [courses] = await poolPromise.query(
      'SELECT co_id, co_name FROM course'
    );

    const overallReport = [];

    for (const course of courses) {
      const courseId = course.co_id;

      const [students] = await poolPromise.query(
        `SELECT s.ssn, s.student_name, s.email
        FROM student s
        INNER JOIN enroll e ON s.ssn = e.ssn
        WHERE e.co_id = ?`,
        [courseId]
      );

      const [courseDates] = await poolPromise.query(
        `SELECT schedule_date
        FROM course_schedule
        WHERE co_id = ?`,
        [courseId]
      );

      const totalDates = courseDates.map((row) => row.schedule_date);

      for (const student of students) {
        const studentId = student.ssn;

        const [attendanceData] = await poolPromise.query(
          `SELECT atten_date
          FROM attend
          WHERE ssn = ? AND co_id = ?`,
          [studentId, courseId]
        );

        const attendedDates = attendanceData.map((row) => row.atten_date);

        overallReport.push({
          ssn: studentId,
          student_name: student.student_name,
          email: student.email,
          co_id: courseId,
          co_name: course.co_name,
          total_attended: attendedDates.length,
          total_absent: totalDates.length - attendedDates.length
        });
      }
    }

    return overallReport;
  } catch (error) {
    throw new Error('Error fetching overall attendance report: ' + error.message);
  }
}

async function updateAbsentDays() {
  try {
    const courses = await poolPromise.query('SELECT co_id FROM course');
    const courseIds = courses[0].map((course) => course.co_id);

    for (const courseId of courseIds) {
      const students = await poolPromise.query(
        'SELECT ssn FROM enroll WHERE co_id = ?',
        [courseId]
      );
      const studentIds = students[0].map((student) => student.ssn);

      for (const studentId of studentIds) {
        const absentData = await getAttendanceByStudentAndCourse(studentId, courseId);
        const numAbsent = absentData.absentDates.length;

        await poolPromise.query(
          'INSERT INTO absent_days (ssn, co_id, num_absent) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE num_absent = ?',
          [studentId, courseId, numAbsent, numAbsent]
        );
      }
    }

    console.log('Absent days updated successfully');
  } catch (error) {
    console.error('Error updating absent days:', error);
    throw error;
  }
}

async function updatePendingWarnings() {
  try {
    const [absentDays] = await poolPromise.query('SELECT ssn, co_id, num_absent FROM absent_days');
    for (const record of absentDays) {
      const { ssn, co_id, num_absent } = record;

      // Check if the student already has a warning for this course
      const [warningResults] = await poolPromise.query(
        'SELECT * FROM warnings WHERE ssn = ? AND co_id = ?',
        [ssn, co_id]
      );


      let newState = null;

      if (warningResults.length > 0) {
        if (warningResults.state === 'first_warning' && num_absent >= secondWarningThreshold) {
          newState = 'second_warning';
        } else if (warningResults.state === 'second_warning' && num_absent >= suspendedThreshold) {
          newState = 'suspended';
        }
      } else if (num_absent >= suspendedThreshold) {
        newState = 'suspended';
      } else if (num_absent >= secondWarningThreshold) {
        newState = 'second_warning';
      } else if (num_absent >= firstWarningThreshold) {
        newState = 'first_warning';
      }

      if (newState) {
        // Check if the student already has a pending warning of the same state
        const [existingPendingWarning] = await poolPromise.query(
          'SELECT * FROM pending_warnings WHERE ssn = ? AND co_id = ? AND state = ?',
          [ssn, co_id, newState]
        );

        if (existingPendingWarning.length == 0) {
          await poolPromise.query(
            'INSERT INTO pending_warnings (ssn, co_id, state, processed, confirmation_sent) VALUES (?, ?, ?, 0, 0) ' +
            'ON DUPLICATE KEY UPDATE state = ?, processed = 0, confirmation_sent = 0',
            [ssn, co_id, newState, newState]
          );
          console.log(`Updated pending warning for student ${ssn}, course ${co_id}: ${newState}`);
        }
      }
    }
    
    console.log('Pending warnings updated successfully.');
  } catch (error) {
    console.error('Error updating pending warnings:', error);
  }
}

//Todo change the email to student email, uncomment the code for sending email
async function sendStudentEmail(ssn, co_id, state, confirmation) {          
  try {
    // Fetch student email based on ssn
    const [studentData] = await poolPromise.query(
      'SELECT email FROM student WHERE ssn = ?',
      [ssn]
    );

    if (studentData.length === 0) {
      console.error('Student not found.');
      return;
    }

    const studentEmail =  'mostafashokry21@gmail.com';
    console.log(`Student email: ${studentData[0].email}`);

    // Compose the email text
    let warningType = '';
    if (state === 'first_warning') {
      warningType = 'first warning';
      num_absent = firstWarningThreshold
    } else if (state === 'second_warning') {
      warningType = 'second warning';
      num_absent = secondWarningThreshold
    } else if (state === 'suspended') {
      warningType = 'suspension';
      num_absent = suspendedThreshold
    }

    // Get the course name based on co_id
    const [courseResults] = await poolPromise.query('SELECT co_name FROM course WHERE co_id = ?', [co_id]);
    const courseName = courseResults.length > 0 ? courseResults[0].co_name : 'Unknown Course';

    const emailText = `
    Dear Student,

    You ${confirmation == 'pending' ? 'may be issued' : 'have been issued'} a ${warningType} for the course "${courseName}". This means that you have accumulated ${num_absent} absent days, and it's important to take appropriate action to improve your attendance.

    Here are the details:

    Course: ${courseName}
    Warning Type: ${warningType}
    Number of Absent Days: ${num_absent}

    Please take the following steps:

    1. Review your attendance records for this course.
    2. Reach out to your instructor to discuss your situation and explore ways to catch up on missed material.
    3. Make a plan to attend all upcoming classes and engage actively in your studies.

    Sincerely,
    mis, Shoubra Faculty of Engineering-Benha University
    `;
   
    // Compose email
    const mailOptions = {
      from: 'mostafashokry2121@gmail.com', // Replace with your email
      to: studentEmail,
      subject: 'Warning Notification',
      text: emailText
    };
  
    // Send the email
    //await transporter.sendMail(mailOptions);
    console.log(`Email sent to student ${ssn}: ${state}`);
  } catch (error) {
    console.error('Error sending student email:', error);
  }
}

async function processAllPendingWarnings() {
  try {
    // Fetch all unprocessed pending warnings
    const [pendingWarnings] = await poolPromise.query('SELECT * FROM pending_warnings WHERE processed = 0');
    
    for (const warning of pendingWarnings) {
      const { ssn, co_id, state } = warning;

      // Send email to the student
      sendStudentEmail(ssn, co_id, state,'pending');

      // Mark the pending warning as processed
      await poolPromise.query(
        'UPDATE pending_warnings SET processed = 1 WHERE ssn = ? AND co_id = ?',
        [ssn, co_id]
      );
    }
    console.log('All pending warnings processed successfully.');
  } catch (error) {
    console.error('Error processing pending warnings:', error);
  }
}

// Function to get pending warnings for instructor to confirm
async function getPendingWarningsForInstructor(instructorId) {
  try {
    // Fetch courses taught by the instructor
    const [courses] = await poolPromise.query(
      'SELECT co_id FROM teach WHERE ins_id = ?',
      [instructorId]
    );

    if (courses.length === 0) {
      return [];
    }

    const courseIds = courses.map((course) => course.co_id);

    // Fetch pending warnings with student, course, and department details for the specified courses
    const [pendingWarnings] = await poolPromise.query(`
      SELECT pw.ssn, pw.co_id, pw.state,
             s.student_name AS student_name, s.st_year AS student_year, s.email AS student_email,
             c.co_name AS course_name, d.dep_name AS department_name,
             ad.num_absent
      FROM pending_warnings pw
      INNER JOIN student s ON pw.ssn = s.ssn
      INNER JOIN course c ON pw.co_id = c.co_id
      INNER JOIN department d ON s.dep_id = d.dep_id
      INNER JOIN absent_days ad ON pw.ssn = ad.ssn AND pw.co_id = ad.co_id
      WHERE  pw.co_id IN (?)
    `, [courseIds]);
    //pw.confirmation_sent = 0 AND



    // Update confirmation_sent to true for the fetched warnings
    if (pendingWarnings.length > 0) {
      const pendingWarningRecords = pendingWarnings.map((warning) => {
        return { ssn: warning.ssn, co_id: warning.co_id };
      });

      const ssnList = pendingWarningRecords.map((warning) => warning.ssn);
      const coIdList = pendingWarningRecords.map((warning) => warning.co_id);

      await poolPromise.query(
        'UPDATE pending_warnings SET confirmation_sent = 1 WHERE ssn IN (?) AND co_id IN (?)',
        [ssnList, coIdList]
      );
    }

    return pendingWarnings;
  } catch (error) {
    console.error('Error fetching and updating pending warnings:', error);
    throw new Error('Error fetching and updating pending warnings');
  }
}

// Function to get resolved warnings for instructor
async function getResolvedWarningsForInstructor(instructorId) {
  try {
    // Fetch courses taught by the instructor
    const [courses] = await poolPromise.query(
      'SELECT co_id FROM teach WHERE ins_id = ?',
      [instructorId]
    );

    if (courses.length === 0) {
      return [];
    }

    const courseIds = courses.map((course) => course.co_id);

    // Fetch resolved warnings with student, course, and department details for the specified courses
    const [resolvedWarnings] = await poolPromise.query(`
      SELECT w.ssn, w.co_id, w.state,
              s.student_name AS student_name, s.st_year AS student_year, s.email AS student_email,
              c.co_name AS course_name, d.dep_name AS department_name,
              ad.num_absent
      FROM warnings w
      INNER JOIN student s ON w.ssn = s.ssn
      INNER JOIN course c ON w.co_id = c.co_id
      INNER JOIN department d ON s.dep_id = d.dep_id
      INNER JOIN absent_days ad ON w.ssn = ad.ssn AND w.co_id = ad.co_id
      WHERE w.co_id IN (?)
    `, [courseIds]);

    return resolvedWarnings;
  } catch (error) {
    console.error('Error fetching resolved warnings:', error);
    throw new Error('Error fetching resolved warnings');
  }
}

// Function to confirm and add pending warning to warnings table
async function confirmAndMovePendingWarning(ssn, co_id) {
  try {
    // Check if the pending warning exists and confirmation is sent
    const [pendingWarningResults] = await poolPromise.query(
      'SELECT * FROM pending_warnings WHERE ssn = ? AND co_id = ? AND confirmation_sent = 1',
      [ssn, co_id]
    );

    if (pendingWarningResults.length === 0) {
      return { success: false, message: 'Student or course not found in pending warnings or confirmation not sent' };
    }

    const pendingWarning = pendingWarningResults[0];
    
    // Notify the student
    sendStudentEmail(pendingWarning.ssn, pendingWarning.co_id, pendingWarning.state, "confirmed");

    // Insert the pending warning into the warnings table
    await poolPromise.query(
      'INSERT INTO warnings (ssn, co_id, state) VALUES (?, ?, ?)',
      [pendingWarning.ssn, pendingWarning.co_id, pendingWarning.state]
    );

    // Delete the pending warning
    await poolPromise.query(
      'DELETE FROM pending_warnings WHERE ssn = ? AND co_id = ?',
      [ssn, co_id]
    );

    return { success: true, message: 'Pending warning confirmed and added to warnings table successfully' };
  } catch (error) {
    console.error('Error confirming and adding pending warning to warnings table:', error);
    return { success: false, message: 'Error confirming and adding pending warning to warnings table' };
  }
}

async function createHistoricalStudentRecords() {
  try {
    // Fetch active students
    const [activeStudents] = await poolPromise.query('SELECT * FROM student');

    for (const student of activeStudents) {
      const { ssn, student_name, email, na_id, st_year, dep_id, academic_year } = student;

      // Concatenate ssn with academic year
      const historicalSsn = `${ssn}-${academic_year}`;

      // Fetch enrolled courses for the student
      const [enrolledCourses] = await poolPromise.query(
        'SELECT e.co_id, c.co_name FROM enroll e JOIN course c ON e.co_id = c.co_id WHERE e.ssn = ?',
        [ssn]
      );

      // Store historical student record
      await poolPromise.query(
        'INSERT INTO historical_student_records (historicalSsn, student_name, email, na_id, st_year, dep_id) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
        [historicalSsn, student_name, email, na_id, st_year, dep_id]
      );

      // Store enrolled course details
      for (const course of enrolledCourses) {
        const { co_id, co_name } = course;

        // Concatenate co_id with academic year
        const historicalCo_id = `${co_id}-${academic_year}`;

        // Get attendance details for the student and course
        const attendanceDetails = await getAttendanceByStudentAndCourse(ssn, co_id);

        const num_absent = attendanceDetails.absentDates.length;
        const num_attended_days = attendanceDetails.studentAttendance.length;

        await poolPromise.query(
          'INSERT INTO historical_course_records (historicalSsn, historicalCo_id, course_name, num_absent, num_attended_days) ' +
          'VALUES (?, ?, ?, ?, ?)',
          [historicalSsn, historicalCo_id, co_name, num_absent, num_attended_days]
        );
      }
    }

    console.log('Historical student records created successfully.');
  } catch (error) {
    console.error('Error creating historical student records:', error);
  }
}

async function getHistoricalCoursesWithAttendanceBySsn(historicalSsn) {
  try {
    const [courses] = await poolPromise.query(`
      SELECT historicalSsn, historicalCo_id, course_name, num_absent, num_attended_days
      FROM historical_course_records
      WHERE historicalSsn = ?
    `, [historicalSsn]);

    return courses;
  } catch (error) {
    throw new Error('Error fetching historical courses with attendance: ' + error.message);
  }
}

async function getHistoricalCourseStudents(historicalCoId) {
  try {
    const [students] = await poolPromise.query(
      `SELECT hcr.historicalSsn, hcr.num_absent, hcr.num_attended_days,
              hcr.course_name, hs.student_name, hs.email
       FROM historical_course_records hcr
       INNER JOIN historical_student_records hs ON hcr.historicalSsn = hs.historicalSsn
       WHERE hcr.historicalCo_id = ?`,
      [historicalCoId]
    );

    return students;
  } catch (error) {
    throw new Error('Error fetching historical course students: ' + error.message);
  }
}

async function updateStudentSSNHistory () {
  try {
    const [students] = await poolPromise.query('SELECT na_id, academic_year FROM student');

    for (const student of students) {
      const { na_id, academic_year } = student;
      const historicalSsn = `${na_id}-${academic_year}`;

      await poolPromise.query(
        'INSERT INTO studentssn_history (na_id, academic_year, historical_ssn) VALUES (?, ?, ?)',
        [na_id, academic_year, historicalSsn]
      );
    }

    console.log('Student SSN history table populated successfully.');
  } catch (error) {
    console.error('Error populating student SSN history table:', error);
  }
}



async function enrollStudentsMainstream(term) {
  try {
    const [students] = await poolPromise.query('SELECT ssn, dep_id, st_year FROM student WHERE ssn LIKE "2%"');
    for (const student of students) {
      const { ssn, dep_id, st_year } = student;

      const matchingCourses = await poolPromise.query(
        'SELECT co_id FROM course WHERE dep_id = ? AND co_year = ? AND co_term = ?', 
        [dep_id, st_year, term]
      );
    
      for (const course of matchingCourses[0]) {
        const [existingEnrollment] = await poolPromise.query(
          'SELECT * FROM enroll WHERE ssn = ? AND co_id = ?', 
          [ssn, course.co_id]
        );

        if (existingEnrollment.length === 0) {
          await poolPromise.query('INSERT INTO enroll (ssn, co_id) VALUES (?, ?)', [ssn, course.co_id]);
        }
      }
    }

    console.log('Enrollment completed successfully');
  } catch (error) {
    throw new Error('Error enrolling students: ' + error.message);
  }
}





function downloadExcelTemplateStudent(res) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  // Add headers to the worksheet
  worksheet.addRow(['Student name', 'National ID', 'B.N.', 'Credit(1) or Mainstream(2)', 'Email', 'Student year', 'Academic year', 'Department number']);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=students-template.xlsx');

  workbook.xlsx.write(res)
    .then(() => {
      res.end();
    })
    .catch(error => {
      console.error('Error sending Excel template:', error);
      res.status(500).json({ error: 'Error sending Excel template' });
    });
}

function downloadExcelTemplateDepartment(res) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  // Add headers to the worksheet
  worksheet.addRow(['Department name', 'Department number']);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=departments-template.xlsx');

  workbook.xlsx.write(res)
    .then(() => {
      res.end();
    })
    .catch(error => {
      console.error('Error sending Excel template:', error);
      res.status(500).json({ error: 'Error sending Excel template' });
    });
}

function downloadExcelTemplateInstructor(res) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  // Add headers to the worksheet
  worksheet.addRow(['Instructor name', 'Position']);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=instructors-template.xlsx');

  workbook.xlsx.write(res)
    .then(() => {
      res.end();
    })
    .catch(error => {
      console.error('Error sending Excel template:', error);
      res.status(500).json({ error: 'Error sending Excel template' });
    });
}

function downloadExcelTemplateCourse(res) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  // Add headers to the worksheet
  worksheet.addRow(['Course name', 'Course code', 'Year', 'Department number']);


  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=courses-template.xlsx');

  workbook.xlsx.write(res)
    .then(() => {
      res.end();
    })
    .catch(error => {
      console.error('Error sending Excel template:', error);
      res.status(500).json({ error: 'Error sending Excel template' });
    });
}

// Function to process and insert student records from Excel
async function processAndInsertStudentRecords(worksheet) {
  const studentRecords = [];

  await worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip the first row
    if (rowNumber === 1) {
      return;
    }
    const student_name = row.getCell(1).value;
    const na_id = row.getCell(2).value;
    const bn = row.getCell(3).value;
    const creditOrMainstream = row.getCell(4).value;
    const cellValue = row.getCell(5).value;
    let email = null;
    if (cellValue !== null) {
      if (typeof cellValue === 'string') {
        email = cellValue;
      } else if (typeof cellValue.text === 'string') {
        email = cellValue.text;
      }
    }
    const st_year = row.getCell(6).value;
    const academic_year = row.getCell(7).value;
    const dep_id = row.getCell(8).value;
    const ssn = `${creditOrMainstream}${dep_id.toString().padStart(2, '0')}${st_year}${bn.toString().padStart(3, '0')}`;

    const st = {
      ssn,
      student_name,
      na_id,
      email,
      st_year,
      academic_year,
      dep_id
    };

    studentRecords.push(st);
  });

  // Insert student records into the database
  await insertData('student', studentRecords);
  await enrollStudentsMainstream(1);
}

// Function to process and insert department records from Excel
async function processAndInsertDepartmentRecords(worksheet) {
  const departmentRecords = [];

  await worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip the first row
    if (rowNumber === 1) {
      return;
    }
    const dep_name = row.getCell(1).value;
    const dep_id = row.getCell(2).value;

    const dp = {
      dep_name,
      dep_id
    };

    departmentRecords.push(dp);
  });

  // Insert student records into the database
  await insertData('department', departmentRecords);
}

// Function to process and insert instructor records from Excel
async function processAndInsertInstructorRecords(worksheet) {
  const instructorRecords = [];

  await worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip the first row
    if (rowNumber === 1) {
      return;
    }
    const ins_name = row.getCell(1).value;
    const position = row.getCell(2).value;

    const ins = {
      ins_name,
      position
    };

    instructorRecords.push(ins);
  });

  // Insert student records into the database
  await insertData('instructor', instructorRecords);
}

//Todo add the term functionality
// Function to process and insert course records from Excel
async function processAndInsertCourseRecords(worksheet) {
  const courseRecords = [];

  await worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip the first row
    if (rowNumber === 1) {
      return;
    }
    const co_name = row.getCell(1).value;
    const co_id = row.getCell(2).value;
    const co_year = row.getCell(3).value;
    const dep_id = row.getCell(4).value;


    const st = {
      co_name,
      co_id,
      co_year,
      co_term : 1,
      dep_id
    };

    courseRecords.push(st);
  });

  // Insert student records into the database
  await insertData('course', courseRecords);
  await enrollStudentsMainstream(1);
}




////////////////////////////////////////////////////  Routes  ////////////////////////////////////////////////////


//////////////////////////////////  student   //////////////////////////////////

// Route to login a student with email and national ID
app.get('/student/login/:email/:na_id', async (req, res) => {
  const { email, na_id } = req.params;

  try {
    const [students] = await pool.promise().query(
      'SELECT ssn FROM student WHERE email = ? AND na_id = ?',
      [email, na_id]
    );

    if (students.length > 0) {
      const studentId = students[0].ssn;
      res.json({ studentId });
    } else {
      res.status(404).json({ error: 'Student not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error fetching student data' });
  }
});

// Route to get student data including number of enrolled courses and suspended courses
app.get('/student/:studentId/data', async (req, res) => {
  const ssn = req.params.studentId;
  try {
    // Fetch student data including department name
    const [studentData] = await poolPromise.query(
      'SELECT s.*, d.dep_name ' +
      'FROM student s ' +
      'LEFT JOIN department d ON s.dep_id = d.dep_id ' +
      'WHERE s.ssn = ?',
      [ssn]
    );
    
    if (studentData.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Fetch enrolled courses count
    const [enrolledCourses] = await poolPromise.query(
      'SELECT COUNT(*) AS count FROM enroll WHERE ssn = ?',
      [ssn]
    );

    // Fetch suspended courses count from the warnings table
    const [suspendedCourses] = await poolPromise.query(
      'SELECT COUNT(*) AS count FROM warnings WHERE ssn = ? AND state = "suspended"',
      [ssn]
    );

    res.json({
      student: studentData[0],
      enrolledCourses: enrolledCourses[0].count,
      suspendedCourses: suspendedCourses[0].count,
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Route to get student summary courses data
app.get('/student-summary/:studentId', async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const summary = await getSummaryForStudent(studentId);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching student summary data' });
  }
});

// Route to get attendance data for a course and student
app.get('/attendance/:courseId/:studentId', async (req, res) => {
  const { courseId, studentId } = req.params;
  try {
    const attendanceData = await getAttendanceByStudentAndCourse(studentId, courseId);
    const mergedAttendanceData = mergeAttendanceData(attendanceData);

    res.json(mergedAttendanceData);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching attendance data' });
  }
});

// Route to get courses enrolled by a student
app.get('/student/:studentId/courses', async (req, res) => {
  const studentId = req.params.studentId;

  try {
    const [courses] = await poolPromise.query(
      `SELECT c.co_id, c.co_name
      FROM course c
      INNER JOIN enroll e ON c.co_id = e.co_id
      WHERE e.ssn = ?`,
      [studentId]
    );

    res.json(courses);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching enrolled courses' });
  }
});



//////////////////////////////////  instructor   //////////////////////////////////

// Route to login an instructor with email and national ID
app.get('/instructor/login/:email/:na_id', async (req, res) => {
  const { email, na_id } = req.params;

  try {
    const [instructors] = await pool.promise().query(
      'SELECT ins_id FROM instructor WHERE email = ? AND na_id = ?',
      [email, na_id]
    );

    if (instructors.length > 0) {
      const instructorId = instructors[0].ins_id;
      res.json({ instructorId });
    } else {
      res.status(404).json({ error: 'Instructor not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error fetching instructor data' });
  }
});

// Route to get instructor summary
app.get('/instructor/:instructorId/summary', async (req, res) => {
  const instructorId = req.params.instructorId;

  try {
    const summary = await getInstructorSummary(instructorId);

    res.json(summary);
  } catch (error) {
    if (error.message === 'Instructor not found') {
      res.status(404).json({ error: 'Instructor not found' });
    } else {
      console.error('Error:', error.message);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// Route to get courses information for an instructor
app.get('/instructor/:instructorId/courses-info', async (req, res) => {
  const instructorId = req.params.instructorId;

  try {
    const coursesInfo = await getCoursesInfoForInstructor(instructorId);
    res.json(coursesInfo);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching courses information' });
  }
});


// Route to get attendance data for all students enrolled in a course
app.get('/course/:courseId/attendance', async (req, res) => {
  const { courseId } = req.params;

  try {
    const attendanceData = await getAttendanceForAllStudentsInCourse(courseId);
    res.json(attendanceData);
  } catch (error) {
    console.error('Error fetching attendance data:', error);
    res.status(500).json({ error: 'Error fetching attendance data' });
  }
});

// Route to download attendance data as Excel for all students enrolled in a course
app.get('/course/:courseId/attendance/download', async (req, res) => {
  const { courseId } = req.params;

  try {
    const attendanceData = await getAttendanceForAllStudentsInCourse(courseId);

    // Get all unique course dates from attendanceData
    const allDates = new Set();
    attendanceData.forEach((studentAttendance) => {
      studentAttendance.attendance.forEach((attendanceEntry) => {
        allDates.add(attendanceEntry.date);
      });
    });
    const courseDates = Array.from(allDates);

    // Create a new workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Attendance');

    // Add headers
    const headerRow = ['Student Name', ...courseDates];
    worksheet.addRow(headerRow);

    // Populate the attendance data
    attendanceData.forEach((studentAttendance) => {
      const studentRow = [studentAttendance.student.student_name];
      courseDates.forEach((date) => {
        const attendanceStatus = studentAttendance.attendance.find((entry) => entry.date === date);
        studentRow.push(attendanceStatus.attended ? 'Present' : 'Absent');
      });
      worksheet.addRow(studentRow);
    });

    // Set response headers for downloading the Excel file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${courseId}.xlsx`);

    // Write the workbook to the response
    await workbook.xlsx.write(res);

    // End the response
    res.end();
  } catch (error) {
    console.error('Error generating and sending Excel file:', error);
    res.status(500).json({ error: 'Error generating and sending Excel file' });
  }
});

// Route to update attendance for a course
app.put('/update-attendance/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const studentList = req.body;
    // Call the updateAttendance function
    const updatedStudentList = await updateAttendance(studentList, courseId);

    // Respond with the updated student list
    res.json(updatedStudentList);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Route to get pending warnings for instructor to confirm
app.get('/get-pending-warnings/:instructorId', async (req, res) => {
  try {
    const instructorId = req.params.instructorId;
    const pendingWarnings = await getPendingWarningsForInstructor(instructorId);
    pendingWarnings.map((warning) => {
      warning.state = mapWarningStateToReadable( warning.state).warningType;
    });
    res.json({ pendingWarnings });
  } catch (error) {
    console.error('Error fetching and updating pending warnings:', error);
    res.status(500).json({ error: 'Error fetching and updating pending warnings' });
  }
});

// Route to get resolved warnings for instructor
app.get('/get-resolved-warnings/:instructorId', async (req, res) => {
  try {
    const instructorId = req.params.instructorId;
    const resolvedWarnings = await getResolvedWarningsForInstructor(instructorId);
    resolvedWarnings.map((warning) => {
      warning.state = mapWarningStateToReadable( warning.state).warningType;
    });
    res.json({ resolvedWarnings });
  } catch (error) {
    console.error('Error fetching and updating pending warnings:', error);
    res.status(500).json({ error: 'Error fetching and updating pending warnings' });
  }
});

// Route to confirm and move pending warning to warnings table and notify the student
app.post('/confirm-warning/:ssn/:co_id', async (req, res) => {
  const { ssn, co_id } = req.params;

  const result = await confirmAndMovePendingWarning(ssn, co_id);

  if (result.success) {
    res.json({ message: result.message });
  } else {
    res.status(500).json({ error: result.message });
  }
});


// Route to get pending illness reports for courses taught by a specific instructor
app.get('/reports/:instructorId/illness-reports', async (req, res) => {
  const { instructorId } = req.params;

  try {
    // Fetch courses taught by the specific instructor
    const [courses] = await pool.promise().query(
      'SELECT c.co_id, c.co_name FROM teach t INNER JOIN course c ON t.co_id = c.co_id WHERE t.ins_id = ?',
      [instructorId]
    );

    if (courses.length === 0) {
      res.status(404).json({ error: 'No courses found for this instructor' });
      return;
    }

    // Fetch illness reports with state 0 for the courses taught by the instructor from the pending_ill_reports table
    const [illnessReports] = await pool.promise().query(
      `SELECT pr.report_id, pr.ssn, pr.date_of_absent, pr.report_text, pr.attachment, s.student_name, c.co_id, c.co_name
       FROM pending_ill_reports pr
       INNER JOIN student s ON pr.ssn = s.ssn
       INNER JOIN course c ON pr.co_id = c.co_id
       WHERE pr.co_id IN (?) AND pr.state = 0`, // Add condition to filter by state
      [courses.map(course => course.co_id)]
    );

    // Format the date_of_absent property in each report
    const formattedIllnessReports = illnessReports.map(report => ({
      ...report,
      date_of_absent: formatDate(report.date_of_absent)
    }));

    res.json(formattedIllnessReports);
  } catch (error) {
    console.error('Error fetching illness reports:', error);
    res.status(500).json({ error: 'Error fetching illness reports' });
  }
});

// Route to confirm illness report
app.put('/confirm-illness-report/:reportId', async (req, res) => {
  const { reportId } = req.params;
  const { newState } = req.body;

  try {
    // Fetch the illness report details
    const [reportResult] = await pool.promise().query(
      'SELECT ssn, co_id, date_of_absent, state FROM pending_ill_reports WHERE report_id = ?',
      [reportId]
    );

    if (reportResult.length === 0) {
      res.status(404).json({ error: 'Illness report not found' });
      return;
    }

    const { ssn, co_id, date_of_absent, state } = reportResult[0];

    // Format the date_of_absent using the formatDate function
    const formattedDateOfAbsent = formatDate(date_of_absent);

    if (newState === 1 || newState === 2) {
      // Update the state of the illness report
      await pool.promise().query(
        'UPDATE pending_ill_reports SET state = ? WHERE report_id = ?',
        [newState, reportId]
      );

      // If newState is 1 (confirmed), mark the formatted date of absence in the attend table with an asterisk (*)
      if (newState === 1) {
        await pool.promise().query(
          'INSERT INTO attend (ssn, co_id, atten_date) VALUES (?, ?, ?)',
          [ssn, co_id, formattedDateOfAbsent]
        );
      }

      res.json({ message: 'Illness report state updated successfully' });
    } else {
      res.status(400).json({ error: 'Invalid newState value. It should be 1 (confirmed) or 2 (rejected)' });
    }
  } catch (error) {
    console.error('Error updating illness report state:', error);
    res.status(500).json({ error: 'Error updating illness report state' });
  }
});

// Route to get confirmed or rejected illness reports for courses taught by a specific instructor
app.get('/confirmed-or-rejected-reports/:instructorId', async (req, res) => {
  const { instructorId } = req.params;

  try {
    // Fetch courses taught by the specific instructor
    const [courses] = await pool.promise().query(
      'SELECT c.co_id, c.co_name FROM teach t INNER JOIN course c ON t.co_id = c.co_id WHERE t.ins_id = ?',
      [instructorId]
    );

    if (courses.length === 0) {
      res.status(404).json({ error: 'No courses found for this instructor' });
      return;
    }

    // Fetch illness reports with state 1 (confirmed) or 2 (rejected) for the courses taught by the instructor from the pending_ill_reports table
    const [illnessReports] = await pool.promise().query(
      `SELECT pr.report_id, pr.ssn, pr.date_of_absent, pr.report_text, pr.attachment, s.student_name, c.co_id, c.co_name, pr.state
       FROM pending_ill_reports pr
       INNER JOIN student s ON pr.ssn = s.ssn
       INNER JOIN course c ON pr.co_id = c.co_id
       WHERE pr.co_id IN (?) AND (pr.state = 1 OR pr.state = 2)`, // Add condition to filter by state
      [courses.map(course => course.co_id)]
    );

    // Format the date_of_absent property in each report
    const formattedIllnessReports = illnessReports.map(report => ({
      ...report,
      date_of_absent: formatDate(report.date_of_absent)
    }));

    res.json(formattedIllnessReports);
  } catch (error) {
    console.error('Error fetching confirmed or rejected illness reports:', error);
    res.status(500).json({ error: 'Error fetching confirmed or rejected illness reports' });
  }
});




//////////////////////////////////  admin   //////////////////////////////////

// Route to login an admin
app.post('/admin/login', async (req, res) => {
  const { username, pass } = req.body;

  try {
    // Check if the admin exists in the database
    const [admins] = await poolPromise.query(
      'SELECT admin_id FROM admin WHERE username = ? AND pass = ?',
      [username, pass]
    );

    if (admins.length > 0) {
      const adminId = admins[0].admin_id;
      res.json({ adminId });
    } else {
      res.status(401).json({ error: 'Admin not found or invalid credentials' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error authenticating admin' });
  }
});





//////////////////////////////////  Server processing   //////////////////////////////////

// Route to update absent days
app.get('/update-absent-days', async (req, res) => {
  try {
    await updateAbsentDays();
    res.json({ message: 'Absent days updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error updating absent days' });
  }
});

// Route to update pending warnings
app.get('/update-pending-warnings', async (req, res) => {
  try {
    await updatePendingWarnings();
    res.json({ message: 'Pending warnings updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error updating pending warnings' });
  }
});

//Route to process all pending warnings
app.get('/process-all-pending-warnings', async (req, res) => {
  try {
    await processAllPendingWarnings();

    res.json({ message: 'All pending warnings processed successfully' });
  } catch (error) {
    console.error('Error processing pending warnings:', error);
    res.status(500).json({ error: 'Error processing pending warnings' });
  }
});

// Route to enroll students mainstream
app.post('/enroll-students-mainstream', async (req, res) => {
  try {
    await enrollStudentsMainstream(1);
    res.json({ message: 'Enrollment completed successfully' });
  } catch (error) {
    console.error('Error enrolling students:', error);
    res.status(500).json({ error: 'Error enrolling students' });
  }
});






//////////////////////////////////  dumb   //////////////////////////////////







// Route to get students enrolled in a course
app.get('/course/:courseId/students', async (req, res) => {
  const courseId = req.params.courseId;

  try {
    const [students] = await poolPromise.query(
      `SELECT s.ssn, s.student_name, s.na_id, s.email, s.st_year, s.dep_id
      FROM student s
      INNER JOIN enroll e ON s.ssn = e.ssn
      WHERE e.co_id = ?`,
      [courseId]
    );

    res.json(students);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching enrolled students' });
  }
});

// // Route to get attendance summary for a student
app.get('/student/:studentId/attendance-summary', async (req, res) => {
  const studentId = req.params.studentId;

  try {
    const attendanceSummary = await getAttendanceSummaryByStudent(studentId);
    res.json(attendanceSummary);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching attendance summary' });
  }
});

// Route to get attendance summary for a course
app.get('/course/:courseId/attendance-summary', async (req, res) => {
  const courseId = req.params.courseId;

  try {
    const attendanceSummary = await getAttendanceSummaryByCourse(courseId);
    res.json(attendanceSummary);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching attendance summary' });
  }
});

// Route to get overall attendance report
app.get('/attendance-report', async (req, res) => {
  try {
    const overallReport = await getOverallAttendanceReport();
    res.json(overallReport);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching overall attendance report' });
  }
});














// Route to create historical student records
app.get('/create-historical-student-records', async (req, res) => {
  try {
    await createHistoricalStudentRecords();
    res.json({ message: 'Historical student records created successfully' });
  } catch (error) {
    console.error('Error creating historical student records:', error);
    res.status(500).json({ error: 'Error creating historical student records' });
  }
});

// Route to get historical courses with attendance by historical SSN
app.get('/get-historical-courses/:historicalSsn', async (req, res) => {
  try {
    const historicalSsn = req.params.historicalSsn;

    // Fetch historical courses with attendance
    const historicalCoursesWithAttendance = await getHistoricalCoursesWithAttendanceBySsn(historicalSsn);

    res.json(historicalCoursesWithAttendance);
  } catch (error) {
    console.error('Error fetching historical courses with attendance:', error);
    res.status(500).json({ error: 'Error fetching historical courses with attendance' });
  }
});

// Route to get historical course students with attendance
app.get('/get-historical-course-students/:historicalCoId', async (req, res) => {
  const historicalCoId = req.params.historicalCoId;

  try {
    const students = await getHistoricalCourseStudents(historicalCoId);
    res.json(students);
  } catch (error) {
    console.error('Error fetching historical course students:', error);
    res.status(500).json({ error: 'Error fetching historical course students with attendance' });
  }
});

// Route to update student SSN history
app.get('/update-student-ssn-history', async (req, res) => {
  try {
    await updateStudentSSNHistory();
    res.json({ message: 'Student SSN history updated successfully' });
  } catch (error) {
    console.error('Error updating student SSN history:', error);
    res.status(500).json({ error: 'Error updating student SSN history' });
  }
});









// // Route to report illness
// app.post('/illness-report', async (req, res) => {
//   const { ssn, co_id, date_of_absent, report_text, attachment } = req.query;

//   try {
//     // Check if the student and course exist
//     const [studentResult] = await pool.promise().query('SELECT ssn FROM student WHERE ssn = ?', [ssn]);
//     const [courseResult] = await pool.promise().query('SELECT co_id FROM course WHERE co_id = ?', [co_id]);

//     if (studentResult.length === 0 || courseResult.length === 0) {
//       return res.status(404).json({ message: 'Student or course not found' });
//     }

//     // Check if the report already exists for the same student, course, and date
//     const [existingReports] = await pool.promise().query(
//       'SELECT report_id FROM pending_ill_reports WHERE ssn = ? AND co_id = ? AND date_of_absent = ?',
//       [ssn, co_id, date_of_absent]
//     );

//     if (existingReports.length > 0) {
//       return res.status(400).json({ message: 'Illness report already exists for this date' });
//     }

   
//     // Check if the date already exists for the given student and course in the attend table
//     const [existingAttendances] = await pool.promise().query(
//       'SELECT atten_date FROM attend WHERE ssn = ? AND co_id = ? AND atten_date = ?',
//       [ssn, co_id, date_of_absent]
//     );
    

//     if (existingAttendances.length > 0) {
//       return res.status(400).json({ message: 'Attendance record already exists for this date' });
//     }

//     // Insert the illness report into the pending_ill_reports table
//     await pool.promise().query(
//       'INSERT INTO pending_ill_reports (ssn, co_id, date_of_absent, report_text, attachment) VALUES (?, ?, ?, ?, ?)',
//       [ssn, co_id, date_of_absent, report_text, attachment]
//     );

//     return res.json({ message: 'Illness report added successfully' });
//   } catch (error) {
//     console.error('Error adding illness report:', error);
//     return res.status(500).json({ message: 'Error adding illness report' });
//   }
// });
// Route to report illness
app.post('/illness-report', async (req, res) => {
  const { ssn, co_id, date_of_absent, report_text, attachment } = req.query;

  try {
    // Check if the student and course exist
    const [studentResult] = await pool.promise().query('SELECT ssn FROM student WHERE ssn = ?', [ssn]);
    const [courseResult] = await pool.promise().query('SELECT co_id FROM course WHERE co_id = ?', [co_id]);

    if (studentResult.length === 0 || courseResult.length === 0) {
      return res.status(404).json({ message: 'Student or course not found' });
    }

    // Check if the report already exists for the same student, course, and date
    const [existingReports] = await pool.promise().query(
      'SELECT report_id FROM pending_ill_reports WHERE ssn = ? AND co_id = ? AND date_of_absent = ?',
      [ssn, co_id, date_of_absent]
    );

    if (existingReports.length > 0) {
      return res.status(400).json({ message: 'Illness report already exists for this date' });
    }

    // Check if the date already exists for the given student and course in the attend table
    const [existingAttendances] = await pool.promise().query(
      'SELECT atten_date FROM attend WHERE ssn = ? AND co_id = ? AND atten_date = ?',
      [ssn, co_id, date_of_absent]
    );

    if (existingAttendances.length > 0) {
      return res.status(400).json({ message: 'Attendance record already exists for this date' });
    }

    // Check if the date exists in the course schedule
    const [courseSchedule] = await pool.promise().query(
      'SELECT schedule_date FROM course_schedule WHERE co_id = ? AND schedule_date = ?',
      [co_id, date_of_absent]
    );

    if (courseSchedule.length === 0) {
      return res.status(400).json({ message: 'Date does not exist in the course schedule' });
    }

    // Insert the illness report into the pending_ill_reports table
    await pool.promise().query(
      'INSERT INTO pending_ill_reports (ssn, co_id, date_of_absent, report_text, attachment) VALUES (?, ?, ?, ?, ?)',
      [ssn, co_id, date_of_absent, report_text, attachment]
    );

    return res.json({ message: 'Illness report added successfully' });
  } catch (error) {
    console.error('Error adding illness report:', error);
    return res.status(500).json({ message: 'Error adding illness report' });
  }
});


















// Route to download Excel template for student
app.get('/download-excel-template-student', (req, res) => {
  downloadExcelTemplateStudent(res);
});
// Route to download Excel template for course
app.get('/download-excel-template-course', (req, res) => {
  downloadExcelTemplateCourse(res);
});
// Route to download Excel template for department
app.get('/download-excel-template-department', (req, res) => {
  downloadExcelTemplateDepartment(res);
});
// Route to download Excel template for instructor
app.get('/download-excel-template-instructor', (req, res) => {
  downloadExcelTemplateInstructor(res);
});



// Set up multer for file uploading
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads'); // Uploads will be stored in the "uploads" directory
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Upload and process filled Excel file for student 
app.post('/upload-excel-file-student', upload.single('excelFile'), async (req, res) => {
  const excelFilePath = req.file.path;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelFilePath);

    const worksheet = workbook.getWorksheet('Sheet1');
    await processAndInsertStudentRecords(worksheet);

    res.json({ message: 'Data uploaded and processed successfully' });
  } catch (error) {
    console.error('Error processing uploaded Excel file:', error);
    res.status(500).json({ error: 'Error processing uploaded Excel file' });
  } finally {
    // Delete the uploaded file
    fs.unlinkSync(excelFilePath);
  }
});

// Upload and process filled Excel file for department 
app.post('/upload-excel-file-department', upload.single('excelFile'), async (req, res) => {
  const excelFilePath = req.file.path;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelFilePath);

    const worksheet = workbook.getWorksheet('Sheet1');
    await processAndInsertDepartmentRecords(worksheet);

    res.json({ message: 'Data uploaded and processed successfully' });
  } catch (error) {
    console.error('Error processing uploaded Excel file:', error);
    res.status(500).json({ error: 'Error processing uploaded Excel file' });
  } finally {
    // Delete the uploaded file
    fs.unlinkSync(excelFilePath);
  }
});

// Upload and process filled Excel file for instructor 
app.post('/upload-excel-file-instructor', upload.single('excelFile'), async (req, res) => {
  const excelFilePath = req.file.path;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelFilePath);

    const worksheet = workbook.getWorksheet('Sheet1');
    await processAndInsertInstructorRecords(worksheet);

    res.json({ message: 'Data uploaded and processed successfully' });
  } catch (error) {
    console.error('Error processing uploaded Excel file:', error);
    res.status(500).json({ error: 'Error processing uploaded Excel file' });
  } finally {
    // Delete the uploaded file
    fs.unlinkSync(excelFilePath);
  }
});

// Upload and process filled Excel file for course
app.post('/upload-excel-file-course', upload.single('excelFile'), async (req, res) => {
  const excelFilePath = req.file.path;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelFilePath);

    const worksheet = workbook.getWorksheet('Sheet1');
    await processAndInsertCourseRecords(worksheet);

    res.json({ message: 'Data uploaded and processed successfully' });
  } catch (error) {
    console.error('Error processing uploaded Excel file:', error);
    res.status(500).json({ error: 'Error processing uploaded Excel file' });
  } finally {
    // Delete the uploaded file
    fs.unlinkSync(excelFilePath);
  }
});



module.exports = {updateAbsentDays, processAllPendingWarnings, updatePendingWarnings, processDataWithCourseId};

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`Example app listening on port ${port}`);
});
