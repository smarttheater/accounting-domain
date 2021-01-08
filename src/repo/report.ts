import * as factory from '@tokyotower/factory';

import { Connection } from 'mongoose';
import AggregateSaleModel from './mongoose/model/aggregateSale';

/**
 * レポートリポジトリ
 */
export class MongoRepository {
    public readonly aggregateSaleModel: typeof AggregateSaleModel;

    constructor(connection: Connection) {
        this.aggregateSaleModel = connection.model(AggregateSaleModel.modelName);
    }

    /**
     * レポートを保管する
     */
    public async saveReport(params: factory.report.order.IReport): Promise<void> {
        await this.aggregateSaleModel.findOneAndUpdate(
            {
                'performance.id': params.performance.id,
                payment_no: params.payment_no,
                payment_seat_index: params.payment_seat_index,
                reservationStatus: params.reservationStatus
            },
            params,
            { new: true, upsert: true }
        )
            .exec();
    }

    /**
     * 入場状態を更新する
     */
    public async updateAttendStatus(params: {
        reservation: { id: string };
        // performance: { id: string };
        // payment_no: string;
        // payment_seat_index: number;
        checkedin: string;
        checkinDate: string;
    }): Promise<void> {
        await this.aggregateSaleModel.update(
            {
                'reservation.id': {
                    $exists: true,
                    $eq: params.reservation.id
                }
                // 'performance.id': params.performance.id,
                // payment_no: params.payment_no,
                // payment_seat_index: params.payment_seat_index
            },
            {
                checkedin: params.checkedin,
                checkinDate: params.checkinDate
            },
            { multi: true }
        )
            .exec();
    }
}
