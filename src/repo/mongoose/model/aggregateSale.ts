import * as mongoose from 'mongoose';

// import Film from './film';
// import Performance from './performance';
// import multilingualString from './schemaTypes/multilingualString';
// import ticketCancelCharge from './schemaTypes/ticketCancelCharge';
// import tttsExtensionTicketType from './schemaTypes/tttsExtensionTicketType';
// import Screen from './screen';
// import Theater from './theater';

const safe: any = { j: 1, w: 'majority', wtimeout: 10000 };

/**
 * 売上集計スキーマ
 */
const schema = new mongoose.Schema(
    {
        payment_no: String, // 購入番号
        payment_seat_index: Number, // 購入座席インデックス
        performance: {
            id: String,
            startDay: String,
            startTime: Date
        },
        theater: {
            name: String
        },
        screen: {
            id: String,
            name: String
        },
        film: {
            id: String,
            name: String
        },
        seat: {
            code: String,
            gradeName: String,
            gradeAdditionalCharge: String
        },
        ticketType: {
            name: String,
            // リリース当初の間違ったマスターデータをカバーするため
            csvCode: String,
            charge: String
        },
        customer: {
            group: String,
            givenName: String,
            familyName: String,
            email: String,
            telephone: String,
            segment: String,
            username: String
        },
        orderDate: Date,
        paymentMethod: String,
        checkedin: String,
        checkinDate: String,
        reservationStatus: String,
        status_sort: String,
        price: String,
        cancellationFee: Number,
        transaction_endDate_bucket: Date
    },
    {
        collection: 'aggregateSales',
        id: true,
        read: 'primaryPreferred',
        safe: safe,
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at'
        },
        toJSON: { getters: true },
        toObject: { getters: true }
    }
);

// 検索
schema.index(
    {
        transaction_endDate_bucket: 1
    }
);

export default mongoose.model('AggregateSale', schema)
    .on('index', (error) => {
        // tslint:disable-next-line:no-single-line-block-comment
        /* istanbul ignore next */
        if (error !== undefined) {
            console.error(error);
        }
    });
