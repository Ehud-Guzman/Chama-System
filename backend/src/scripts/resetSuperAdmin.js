// Reset super admin password by deleting existing and creating new one
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Usage: node src/scripts/resetSuperAdmin.js "Full Name" email@example.com "password"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  // Delete existing super admin
  const result = await User.deleteOne({ role: 'super_admin' });
  if (result.deletedCount > 0) {
    console.log('Deleted existing super admin.');
  }

  // Create new super admin
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password: await bcrypt.hash(password, 10),
    role: 'super_admin',
  });

  console.log(`Super admin reset: ${user.name} <${user.email}>`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
