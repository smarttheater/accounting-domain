"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
/**
 * SendGridイベント通知スキーマ
 */
const schema = new mongoose.Schema({
    payment_no: String,
    status: String,
    sg_event_id: String,
    sg_message_id: String,
    event: String,
    email: String,
    timestamp: Number,
    'smtp-id': String,
    category: [String],
    asm_group_id: Number,
    reason: String,
    type: String,
    ip: String,
    tls: String,
    cert_err: String,
    useragent: String,
    url: String,
    url_offset: {
        index: String,
        type: String
    },
    response: String,
    send_at: Number
}, {
    collection: 'sendgrid_event_notifications',
    id: true,
    read: 'primaryPreferred',
    safe: { j: 1, w: 'majority', wtimeout: 10000 },
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    },
    toJSON: { getters: true },
    toObject: { getters: true }
});
exports.default = mongoose.model('SendGridEventNotification', schema);