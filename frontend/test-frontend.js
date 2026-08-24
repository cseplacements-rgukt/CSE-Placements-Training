const axios = require('axios');
axios.post('http://localhost:5000/api/exams', {
  title: "Test Exam",
  targetCompany: "TCS",
  scheduledAt: new Date().toISOString(),
  duration: 60,
  examCategory: "Aptitude",
  questions: [],
  settings: {}
}, {
  headers: {
    Authorization: "Bearer " + "valid-tnpc-token" // Wait, I need a valid token.
  }
}).then(res => console.log(res.data)).catch(err => console.log(err.response?.data || err.message));
