const mongoose = require('mongoose');

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Error connecting to MongoDB', err));

mongoose.connection.on('error', err => {
  console.error('MongoDB connection error', err);
});

// Schema for subscribe
const subscriptionSchema = new mongoose.Schema({
  userId: Number,
  animeId: Number,
  animeName: String,
  lastEpisode: Number,
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = { Subscription };
