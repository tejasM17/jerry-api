"use strict";

// Firebase authentication middleware for the API.
// Directly uses the protect middleware that verifies Firebase ID tokens.
// This file replaces the old Clerk/Firebase switch.

const protect = require("./auth.middleware");

module.exports = protect;
