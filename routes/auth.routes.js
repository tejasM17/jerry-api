"use strict";

const express = require("express");
const protect = require("../middleware/auth.switch");
const { getProfile, syncUser } = require("../controllers/auth.controller");

const router = express.Router();

router.get("/me", protect, getProfile);
router.post("/sync", protect, syncUser);

module.exports = router;
