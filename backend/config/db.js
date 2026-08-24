const mongoose = require('mongoose');

// Keep mongoose quiet in production; noisy query logging costs CPU under load.
mongoose.set('debug', false);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mod-u-go', {
      // Pool sized for MongoDB Atlas M0/M2 shared tiers (~100 connection
      // limit): a single Node process rarely needs more than 10 concurrent
      // connections, and each Render instance gets its own pool.
      maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '10', 10),
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      // Atlas requires TLS-aware driver settings only via the URI — no extra
      // flags needed here. useNewUrlParser/useUnifiedTopology are deprecated
      // no-ops on driver v4+ and have been removed.
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
