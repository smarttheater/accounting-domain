/**
 * 返品取引ファクトリー
 * @namespace transaction.returnOrder
 */

import * as GMO from '@motionpicture/gmo-service';

import { IExtendId } from '../autoGenerated';
import { IPerson } from '../person';
import * as TransactionFactory from '../transaction';
import * as IPlaceOrderTransactionFactory from '../transaction/placeOrder';
import TransactionStatusType from '../transactionStatusType';
import TransactionTasksExportationStatus from '../transactionTasksExportationStatus';
import TransactionType from '../transactionType';

/**
 * クレジットカード売上取消結果インターフェース
 * @interface
 */
export type IReturnCreditCardResult = GMO.services.credit.IAlterTranResult;
/**
 * クレジットカード金額変更結果インターフェース
 * @interface
 */
export type IChangeCreditCardAmountResult = GMO.services.credit.IChangeTranResult;

/**
 * agent interface
 * 購入者インターフェース
 * @export
 * @interface
 * @memberof transaction.returnOrder
 */
export type IAgent = IPerson;

/**
 * result interface
 * 取引結果インターフェース
 * @export
 * @interface
 * @memberof transaction.returnOrder
 */
// tslint:disable-next-line:no-empty-interface
export interface IResult {
    returnCreditCardResult?: IReturnCreditCardResult;
    changeCreditCardAmountResult?: IChangeCreditCardAmountResult;
}

/**
 * error interface
 * エラーインターフェース
 * @export
 * @interface
 * @memberof transaction.returnOrder
 */
export type IError = any;

/**
 * object of a transaction interface
 * 取引対象物インターフェース
 * @export
 * @interface
 * @memberof transaction.returnOrder
 */
export interface IObject {
    transaction: IPlaceOrderTransactionFactory.ITransaction;
    cancelName: string;
    cancellationFee: number;
}

export type ITransaction = IExtendId<IAttributes>;

/**
 * 返品取引インターフェース
 * @export
 * @interface
 * @memberof transaction.returnOrder
 */
export interface IAttributes extends TransactionFactory.IAttributes {
    /**
     * 購入者
     */
    agent: IAgent;
    /**
     * 取引の結果発生するもの
     */
    result?: IResult;
    /**
     * 取引に関するエラー
     */
    error?: IError;
    /**
     * 取引の対象物
     */
    object: IObject;
}

/**
 * 返品取引オブジェクトを生成する。
 * @export
 * @function
 * @memberof transaction.returnOrder
 */
export function createAttributes(params: {
    status: TransactionStatusType;
    agent: IAgent
    result?: IResult;
    error?: IError;
    object: IObject;
    expires: Date;
    startDate?: Date;
    endDate?: Date;
    tasksExportedAt?: Date;
    tasksExportationStatus: TransactionTasksExportationStatus;
}): IAttributes {
    return {
        ...TransactionFactory.createAttributes({
            typeOf: TransactionType.ReturnOrder,
            status: params.status,
            agent: params.agent,
            result: params.result,
            error: params.error,
            object: params.object,
            expires: params.expires,
            startDate: params.startDate,
            endDate: params.endDate,
            tasksExportedAt: params.tasksExportedAt,
            tasksExportationStatus: params.tasksExportationStatus
        }),
        ...{
            object: params.object
        }
    };
}