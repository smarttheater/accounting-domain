/**
 * 仮予約
 */
export declare const STATUS_TEMPORARY = "TEMPORARY";
/**
 * CHEVRE確保上の仮予約
 */
export declare const STATUS_TEMPORARY_ON_KEPT_BY_CHEVRE = "TEMPORARY_ON_KEPT_BY_CHEVRE";
/**
 * 決済待ち
 */
export declare const STATUS_WAITING_SETTLEMENT = "WAITING_SETTLEMENT";
/**
 * ペイデザイン決済待ち
 */
export declare const STATUS_WAITING_SETTLEMENT_PAY_DESIGN = "WAITING_SETTLEMENT_PAY_DESIGN";
/**
 * CHEVRE確保
 */
export declare const STATUS_KEPT_BY_CHEVRE = "KEPT_BY_CHEVRE";
/**
 * メルマガ会員保留
 */
export declare const STATUS_KEPT_BY_MEMBER = "KEPT_BY_MEMBER";
/**
 * 予約確定
 */
export declare const STATUS_RESERVED = "RESERVED";
/**
 * 一般
 */
export declare const PURCHASER_GROUP_CUSTOMER = "01";
/**
 * メルマガ会員先行
 */
export declare const PURCHASER_GROUP_MEMBER = "02";
/**
 * 外部関係者
 */
export declare const PURCHASER_GROUP_SPONSOR = "03";
/**
 * 内部関係者
 */
export declare const PURCHASER_GROUP_STAFF = "04";
/**
 * 電話
 */
export declare const PURCHASER_GROUP_TEL = "05";
/**
 * 窓口
 */
export declare const PURCHASER_GROUP_WINDOW = "06";
/**
 * MX4D追加料金
 */
export declare const CHARGE_MX4D = 1200;
/**
 * コンビニ決済手数料
 */
export declare const CHARGE_CVS = 150;
export declare const CHECK_DIGIT_WEIGHTS: number[];
export declare const SORT_TYPES_PAYMENT_NO: number[][];
/**
 * 購入管理番号生成
 */
export declare function publishPaymentNo(cb: (err: Error, no: string | null) => void): void;
/**
 * チェックディジットを求める
 *
 * @param {string} source
 */
export declare function getCheckDigit(source: string): number;
/**
 * チェックディジットを求める2
 *
 * @param {string} source
 */
export declare function getCheckDigit2(source: string): number;
/**
 * 購入番号の有効性をチェックする
 *
 * @param {string} paymentNo
 */
export declare function isValidPaymentNo(paymentNo: string): boolean;
export declare function decodePaymentNo(paymentNo: string): string;
