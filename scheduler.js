const cron = require('node-cron');
const {
  processDataWithCourseId,
  updateAbsentDays,
  updatePendingWarnings,
  processAllPendingWarnings
} = require('./server');




cron.schedule('* * * * *', async () => {
  console.log('Starting scheduled tasks...');

  try {
    await processDataWithCourseId();
    await updateAbsentDays();
    await updatePendingWarnings();
    await processAllPendingWarnings();

    console.log('All scheduled tasks completed.');
  } catch (error) {
    console.error('Error in scheduled tasks:', error);
  }
});
