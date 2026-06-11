// Simple in-memory store — swap out for MongoDB/PostgreSQL when ready
const users = new Map();
const transactions = new Map();

module.exports = { users, transactions };
