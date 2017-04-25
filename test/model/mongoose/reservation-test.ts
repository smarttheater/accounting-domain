/**
 * 予約スキーマテスト
 */

import * as assert from 'assert';

import Reservation from '../../../lib/model/mongoose/reservation';
import * as ReservationUtil from '../../../lib/util/reservation';

describe('予約スキーマ 初期値', () => {
    before(async () => {
        // 予約全削除
        await Reservation.remove({}).exec();
    });

    it('入場履歴の初期値は空配列', async () => {
        // 入場履歴がundefinedなテストデータ作成
        const reservation = {
            performance: 'xxx',
            seat_code: 'xxx',
            status: ReservationUtil.STATUS_TEMPORARY
        };
        const reservationDoc = await Reservation.create(reservation);

        // 入場履歴が空配列かどうか確認
        assert(Array.isArray(reservationDoc.get('checkins')));
        assert((<any[]>reservationDoc.get('checkins')).length === 0);

        // テストデータ削除
        await reservationDoc.remove();
    });
});
