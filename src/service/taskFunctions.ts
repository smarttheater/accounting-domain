/**
 * タスクファンクションサービス
 * タスク名ごとに、実行するファンクションをひとつずつ定義しています
 * @namespace service.taskFunctions
 */

import * as mongoose from 'mongoose';
import * as redis from 'redis';

import * as factory from '../factory';

import { MongoRepository as SeatReservationAuthorizeActionRepo } from '../repo/action/authorize/seatReservation';
import { MongoRepository as PerformanceRepo } from '../repo/performance';
import { MongoRepository as ReservationRepo } from '../repo/reservation';
import { MongoRepository as StockRepo } from '../repo/stock';
import { MongoRepository as TransactionRepo } from '../repo/transaction';
import { RedisRepository as WheelchairReservationCountRepo } from '../repo/wheelchairReservationCount';

import * as NotificationService from '../service/notification';
import * as OrderService from '../service/order';
import * as SalesService from '../service/sales';
import * as StockService from '../service/stock';

export type IOperation<T> = (connection: mongoose.Connection, redisClient: redis.RedisClient) => Promise<T>;

export function sendEmailNotification(
    data: factory.task.sendEmailNotification.IData
): IOperation<void> {
    return async (__: mongoose.Connection) => {
        await NotificationService.sendEmail(data.emailMessage)();
    };
}

export function cancelSeatReservation(
    data: factory.task.cancelSeatReservation.IData
): IOperation<void> {
    return async (connection: mongoose.Connection, redisClient: redis.RedisClient) => {
        const seatReservationAuthorizeActionRepo = new SeatReservationAuthorizeActionRepo(connection);
        const stockRepo = new StockRepo(connection);
        const wheelchairReservationCountRepo = new WheelchairReservationCountRepo(redisClient);
        await StockService.cancelSeatReservationAuth(data.transactionId)(
            seatReservationAuthorizeActionRepo, stockRepo, wheelchairReservationCountRepo
        );
    };
}

export function cancelCreditCard(
    data: factory.task.cancelCreditCard.IData
): IOperation<void> {
    return async () => {
        await SalesService.cancelCreditCardAuth(data.transactionId);
    };
}

export function settleSeatReservation(
    data: factory.task.settleSeatReservation.IData
): IOperation<void> {
    return async () => {
        await StockService.transferSeatReservation(data.transactionId);
    };
}

export function settleCreditCard(
    data: factory.task.settleCreditCard.IData
): IOperation<void> {
    return async () => {
        await SalesService.settleCreditCardAuth(data.transactionId);
    };
}

export function returnOrder(
    data: factory.task.returnOrder.IData
): IOperation<void> {
    return async (connection: mongoose.Connection, redisClient: redis.RedisClient) => {
        const performanceRepo = new PerformanceRepo(connection);
        const reservationRepo = new ReservationRepo(connection);
        const stockRepo = new StockRepo(connection);
        const transactionRepo = new TransactionRepo(connection);
        const wheelchairReservationCountRepo = new WheelchairReservationCountRepo(redisClient);

        await OrderService.processReturn(data.transactionId)(
            performanceRepo, reservationRepo, stockRepo, transactionRepo, wheelchairReservationCountRepo
        );
    };
}

export function returnOrdersByPerformance(
    data: factory.task.returnOrdersByPerformance.IData
): IOperation<void> {
    return async (connection: mongoose.Connection) => {
        const performanceRepo = new PerformanceRepo(connection);
        const reservationRepo = new ReservationRepo(connection);
        const transactionRepo = new TransactionRepo(connection);

        await OrderService.processReturnAllByPerformance(data.performanceId)(
            performanceRepo, reservationRepo, transactionRepo
        );
    };
}
