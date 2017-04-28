"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
/**
 * GMO結果通知スキーマ
 */
const schema = new mongoose.Schema({
    shop_id: String,
    order_id: String,
    status: String,
    job_cd: String,
    amount: String,
    pay_type: String,
    tax: String,
    access_id: String,
    forward: String,
    method: String,
    approve: String,
    tran_id: String,
    tran_date: String,
    cvs_code: String,
    cvs_conf_no: String,
    cvs_receipt_no: String,
    payment_term: String,
    process_status: {
        type: String,
        required: true
    }
}, {
    collection: 'gmo_notifications',
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
exports.default = mongoose.model('GMONotification', schema);