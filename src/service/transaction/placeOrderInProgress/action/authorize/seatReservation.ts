/**
 * 座席予約オファー承認サービス
 */
import * as createDebug from 'debug';
import * as moment from 'moment-timezone';

import * as factory from '@motionpicture/ttts-factory';

import { MongoRepository as SeatReservationAuthorizeActionRepo } from '../../../../../repo/action/authorize/seatReservation';
import { RedisRepository as PaymentNoRepo } from '../../../../../repo/paymentNo';
import { MongoRepository as PerformanceRepo } from '../../../../../repo/performance';
import { RedisRepository as TicketTypeCategoryRateLimitRepo } from '../../../../../repo/rateLimit/ticketTypeCategory';
import { RedisRepository as StockRepo } from '../../../../../repo/stock';
import { MongoRepository as TaskRepo } from '../../../../../repo/task';
import { MongoRepository as TransactionRepo } from '../../../../../repo/transaction';

const debug = createDebug('ttts-domain:service');

const WHEEL_CHAIR_NUM_ADDITIONAL_STOCKS = (process.env.WHEEL_CHAIR_NUM_ADDITIONAL_STOCKS !== undefined)
    ? Number(process.env.WHEEL_CHAIR_NUM_ADDITIONAL_STOCKS)
    // tslint:disable-next-line:no-magic-numbers
    : 6;

const WHEEL_CHAIR_RATE_LIMIT_UNIT_IN_SECONDS = 3600;

export type ICreateOpetaiton<T> = (
    transactionRepo: TransactionRepo,
    performanceRepo: PerformanceRepo,
    seatReservationAuthorizeActionRepo: SeatReservationAuthorizeActionRepo,
    paymentNoRepo: PaymentNoRepo,
    ticketTypeCategoryRateLimitRepo: TicketTypeCategoryRateLimitRepo,
    stockRepo: StockRepo,
    taskRepo: TaskRepo
) => Promise<T>;

export type ICancelOpetaiton<T> = (
    transactionRepo: TransactionRepo,
    seatReservationAuthorizeActionRepo: SeatReservationAuthorizeActionRepo,
    ticketTypeCategoryRateLimitRepo: TicketTypeCategoryRateLimitRepo,
    stockRepo: StockRepo,
    taskRepo: TaskRepo
) => Promise<T>;

export type IValidateOperation<T> = (
    ticketTypeCategoryRateLimitRepo: TicketTypeCategoryRateLimitRepo
) => Promise<T>;

/**
 * 座席予約に対する承認アクションを開始する前の処理
 * 供給情報の有効性の確認などを行う。
 * この処理次第で、どのような供給情報を受け入れられるかが決定するので、とても大事な処理です。
 * バグ、不足等あれば、随時更新することが望ましい。
 */
function validateOffers(
    performance: factory.performance.IPerformanceWithDetails,
    acceptedOffers: factory.offer.seatReservation.IAcceptedOffer[]
): IValidateOperation<factory.offer.seatReservation.IOffer[]> {
    return async (__3: TicketTypeCategoryRateLimitRepo) => {
        // 券種情報を取得
        return acceptedOffers.map((offer) => {
            const ticketType = performance.ticket_type_group.ticket_types.find((t) => t.id === offer.ticket_type);
            if (ticketType === undefined) {
                throw new factory.errors.NotFound('offers', 'Ticket type not found.');
            }

            const unitPriceSpec = ticketType.priceSpecification;
            if (unitPriceSpec === undefined) {
                throw new factory.errors.NotFound('Unit Price Specification');
            }

            return {
                ...offer,
                ...{
                    price: unitPriceSpec.price,
                    priceCurrency: factory.priceCurrency.JPY,
                    ticket_type: ticketType.id,
                    ticket_type_name: ticketType.name,
                    ticket_type_charge: unitPriceSpec.price,
                    ticket_cancel_charge: ticketType.cancel_charge,
                    ticket_ttts_extension: ticketType.ttts_extension,
                    rate_limit_unit_in_seconds: (ticketType.ttts_extension.category === factory.ticketTypeCategory.Wheelchair)
                        ? WHEEL_CHAIR_RATE_LIMIT_UNIT_IN_SECONDS
                        : 0
                }
            };
        });
    };
}

/**
 * 座席を仮予約する
 * 承認アクションオブジェクトが返却されます。
 */
// tslint:disable-next-line:max-func-body-length
export function create(
    agentId: string,
    transactionId: string,
    perfomanceId: string,
    acceptedOffers: factory.offer.seatReservation.IAcceptedOffer[]
): ICreateOpetaiton<factory.action.authorize.seatReservation.IAction> {
    // tslint:disable-next-line:max-func-body-length
    return async (
        transactionRepo: TransactionRepo,
        performanceRepo: PerformanceRepo,
        seatReservationAuthorizeActionRepo: SeatReservationAuthorizeActionRepo,
        paymentNoRepo: PaymentNoRepo,
        ticketTypeCategoryRateLimitRepo: TicketTypeCategoryRateLimitRepo,
        stockRepo: StockRepo,
        taskRepo: TaskRepo
    ): Promise<factory.action.authorize.seatReservation.IAction> => {
        debug('creating seatReservation authorizeAction...acceptedOffers:', acceptedOffers.length);

        const transaction = await transactionRepo.findPlaceOrderInProgressById(transactionId);

        if (transaction.agent.id !== agentId) {
            throw new factory.errors.Forbidden('A specified transaction is not yours.');
        }

        // パフォーマンスを取得
        const performance = await performanceRepo.findById(perfomanceId);

        // 供給情報の有効性を確認
        const offers = await validateOffers(performance, acceptedOffers)(ticketTypeCategoryRateLimitRepo);

        // 承認アクションを開始
        const action = await seatReservationAuthorizeActionRepo.start(
            transaction.seller,
            {
                id: transaction.agent.id,
                typeOf: factory.personType.Person
            },
            {
                transactionId: transactionId,
                offers: acceptedOffers,
                performance: performance
            }
        );

        // 在庫から仮予約
        const tmpReservations: factory.action.authorize.seatReservation.ITmpReservation[] = [];
        const performanceStartDate = moment(performance.start_date).toDate();

        try {
            // この時点でトークンに対して購入番号発行(上映日が決まれば購入番号を発行できる)
            const paymentNo = await paymentNoRepo.publish(moment(performance.start_date).tz('Asia/Tokyo').format('YYYYMMDD'));

            // 在庫をおさえると、座席コードが決定する
            debug('finding available seats...');

            // 車椅子予約がある場合、レート制限
            await Promise.all(offers.map(async (offer) => {
                if (offer.rate_limit_unit_in_seconds > 0) {
                    // 車椅子レート制限枠確保(取引IDを保持者に指定)
                    await ticketTypeCategoryRateLimitRepo.lock(
                        {
                            performanceStartDate: performanceStartDate,
                            ticketTypeCategory: offer.ticket_ttts_extension.category,
                            unitInSeconds: offer.rate_limit_unit_in_seconds
                        },
                        transaction.id
                    );
                    debug('wheelchair rate limit checked.');
                }
            }));

            // 仮予約作成(直列実行すること)
            for (const offer of offers) {
                try {
                    tmpReservations.push(
                        await reserveTemporarilyByOffer(transaction.id, paymentNo, performance, offer)({
                            stock: stockRepo
                        })
                    );
                } catch (error) {
                    // no op
                }
            }
            debug(tmpReservations.length, 'tmp reservation(s) created.');

            // 予約枚数が指定枚数に達しなかった場合エラー
            const numberOfHoldStock = tmpReservations.reduce((a, b) => a + b.stocks.length, 0);
            const requiredNumberOfStocks = offers.length;
            if (numberOfHoldStock < requiredNumberOfStocks) {
                throw new factory.errors.AlreadyInUse('action.object', ['offers'], 'No available seats.');
            }
        } catch (error) {
            // actionにエラー結果を追加
            try {
                const actionError = (error instanceof Error) ? { ...error, ...{ message: error.message } } : error;
                await seatReservationAuthorizeActionRepo.giveUp(action.id, actionError);
            } catch (__) {
                // 失敗したら仕方ない
            }

            try {
                // 仮予約があれば削除
                await removeTmpReservations(tmpReservations, performance)({ stock: stockRepo });

                // 車椅子のレート制限カウント数が車椅子要求数以下であれば、このアクションのために枠確保済なので、それを解放
                await Promise.all(offers.map(async (offer) => {
                    if (offer.rate_limit_unit_in_seconds > 0) {
                        const rateLimitKey = {
                            performanceStartDate: performanceStartDate,
                            ticketTypeCategory: offer.ticket_ttts_extension.category,
                            unitInSeconds: offer.rate_limit_unit_in_seconds
                        };
                        const holder = await ticketTypeCategoryRateLimitRepo.getHolder(rateLimitKey);
                        if (holder === transaction.id) {
                            debug('resetting wheelchair rate limit...');
                            await ticketTypeCategoryRateLimitRepo.unlock(rateLimitKey);
                            debug('wheelchair rate limit reset.');
                        }
                    }
                }));
            } catch (error) {
                // no op
                // 失敗したら仕方ない
            }

            throw error;
        }

        try {
            // 集計タスク作成
            const aggregateTask: factory.task.aggregateEventReservations.IAttributes = {
                name: factory.taskName.AggregateEventReservations,
                status: factory.taskStatus.Ready,
                runsAt: new Date(),
                remainingNumberOfTries: 3,
                // tslint:disable-next-line:no-null-keyword
                lastTriedAt: null,
                numberOfTried: 0,
                executionResults: [],
                data: { id: performance.id }
            };
            await taskRepo.save(aggregateTask);
        } catch (error) {
            // no op
        }

        // アクションを完了
        debug('ending authorize action...');

        return seatReservationAuthorizeActionRepo.complete(
            action.id,
            {
                price: tmpReservations
                    .filter((r) => r.status_after === factory.reservationStatusType.ReservationConfirmed)
                    .reduce((a, b) => a + b.charge, 0),
                tmpReservations: tmpReservations
            }
        );
    };
}

/**
 * 1offerの仮予約を実行する
 */
// tslint:disable-next-line:max-func-body-length
function reserveTemporarilyByOffer(
    transactionId: string,
    paymentNo: string,
    performance: factory.performance.IPerformanceWithDetails,
    offer: factory.offer.seatReservation.IOffer
) {
    // tslint:disable-next-line:max-func-body-length
    return async (repos: {
        stock: StockRepo;
    }): Promise<factory.action.authorize.seatReservation.ITmpReservation> => {
        const holdStocks: factory.reservation.event.IStock[] = [];

        try {
            const section = performance.screen.sections[0];

            // まず利用可能な座席は全座席
            let availableSeats = section.seats;
            debug('all availableSeats:', availableSeats);

            // 全車椅子座席
            const wheelChairSeats = availableSeats.filter(
                (s) => s.seatingType.typeOf === factory.place.movieTheater.SeatingType.Wheelchair
            );

            const unavailableSeats = await repos.stock.findUnavailableOffersByEventId({ eventId: performance.id });
            const unavailableSeatNumbers = unavailableSeats.map((s) => s.seatNumber);
            debug('unavailableSeatNumbers:', unavailableSeatNumbers.length);

            // 確保済の車椅子座席
            const unavailableWheelChairSeatCount = wheelChairSeats.filter(
                (s) => unavailableSeatNumbers.indexOf(s.code) >= 0
            ).length;
            debug(unavailableWheelChairSeatCount, 'wheelChair seats unavailable');

            // 一般空席数
            const availableNormalSeatsCount = availableSeats.filter(
                (s) => s.seatingType.typeOf === factory.place.movieTheater.SeatingType.Normal
                    && unavailableSeatNumbers.indexOf(s.code) < 0
            ).length;

            // 未確保の座席に絞る
            availableSeats = availableSeats.filter((s) => unavailableSeatNumbers.indexOf(s.code) < 0);

            // 車椅子予約の場合、車椅子座席に絞る
            // 一般予約は、車椅子座席でも予約可能
            const isWheelChairOffer = offer.ticket_ttts_extension.category === factory.ticketTypeCategory.Wheelchair;
            if (isWheelChairOffer) {
                // 車椅子予約の場合、車椅子タイプ座席のみ
                availableSeats = availableSeats.filter(
                    (s) => s.seatingType.typeOf === factory.place.movieTheater.SeatingType.Wheelchair
                );

                // 車椅子確保分が一般座席になければ車椅子は0
                if (availableNormalSeatsCount < WHEEL_CHAIR_NUM_ADDITIONAL_STOCKS) {
                    availableSeats = [];
                }
            } else {
                // 確保済の車椅子座席があり、かつ一般座席予約の場合、空席から余分確保分を除く
                availableSeats = availableSeats.filter(
                    (s) => s.seatingType.typeOf === factory.place.movieTheater.SeatingType.Normal
                );
                if (unavailableWheelChairSeatCount > 0) {
                    availableSeats = availableSeats.slice(0, -(WHEEL_CHAIR_NUM_ADDITIONAL_STOCKS * unavailableWheelChairSeatCount));
                }
            }
            debug('availableSeats:', availableSeats);

            // 1つ空席を選択
            const availableSeat = availableSeats.find((s) => unavailableSeatNumbers.indexOf(s.code) < 0);
            debug('availableSeat:', availableSeat);

            // 空席があれば確保
            if (availableSeat !== undefined) {
                debug('locking...', availableSeat.code);
                await repos.stock.lock({
                    eventId: performance.id,
                    offers: [{
                        seatSection: section.code,
                        seatNumber: availableSeat.code
                    }],
                    expires: moment(performance.end_date).add(1, 'month').toDate(),
                    holder: transactionId
                });
                debug('locked:', availableSeat.code);

                // 更新エラー(対象データなし):次のseatへ
                holdStocks.push({
                    id: `${performance.id}-${availableSeat.code}`,
                    seat_code: availableSeat.code,
                    availability_before: factory.itemAvailability.InStock,
                    availability_after: factory.itemAvailability.OutOfStock,
                    holder: transactionId
                });
            }
        } catch (error) {
            // no op
            debug(error);
        }

        if (holdStocks.length <= 0) {
            throw new Error('Available stock not found.');
        }

        // ひとつでも在庫確保があれば仮予約オブジェクトを作成
        const seatCode = holdStocks[0].seat_code;
        const seatInfo = performance.screen.sections[0].seats.find((seat) => (seat.code === seatCode));
        if (seatInfo === undefined) {
            throw new factory.errors.NotFound('Seat code', 'Seat code does not exist in the screen.');
        }

        return {
            stocks: holdStocks,
            status_after: factory.reservationStatusType.ReservationConfirmed,
            seat_code: seatCode,
            seat_grade_name: {
                en: 'Normal Seat',
                ja: 'ノーマルシート'
            },
            seat_grade_additional_charge: 0,
            ticket_type: offer.ticket_type,
            ticket_type_name: offer.ticket_type_name,
            ticket_type_charge: offer.ticket_type_charge,
            charge: Number(offer.ticket_type_charge),
            watcher_name: offer.watcher_name,
            ticket_cancel_charge: offer.ticket_cancel_charge,
            ticket_ttts_extension: offer.ticket_ttts_extension,
            rate_limit_unit_in_seconds: offer.rate_limit_unit_in_seconds,
            payment_no: paymentNo
        };
    };
}

/**
 * 座席予約承認アクションをキャンセルする
 */
export function cancel(
    agentId: string,
    transactionId: string,
    actionId: string
): ICancelOpetaiton<void> {
    return async (
        transactionRepo: TransactionRepo,
        seatReservationAuthorizeActionRepo: SeatReservationAuthorizeActionRepo,
        ticketTypeCategoryRateLimitRepo: TicketTypeCategoryRateLimitRepo,
        stockRepo: StockRepo,
        taskRepo: TaskRepo
    ) => {
        try {
            const transaction = await transactionRepo.findPlaceOrderInProgressById(transactionId);

            if (transaction.agent.id !== agentId) {
                throw new factory.errors.Forbidden('A specified transaction is not yours.');
            }

            // アクションではcompleteステータスであるにも関わらず、在庫は有になっている、というのが最悪の状況
            // それだけは回避するためにアクションを先に変更
            const action = await seatReservationAuthorizeActionRepo.cancel(actionId, transactionId);
            const actionResult = <factory.action.authorize.seatReservation.IResult>action.result;

            const performance = action.object.performance;

            // 在庫から仮予約削除
            debug(`removing ${actionResult.tmpReservations.length} tmp reservations...`);
            await removeTmpReservations(actionResult.tmpReservations, performance)({ stock: stockRepo });

            // レート制限があれば解除
            const performanceStartDate = moment(performance.start_date).toDate();
            await Promise.all(actionResult.tmpReservations.map(async (tmpReservation) => {
                if (tmpReservation.rate_limit_unit_in_seconds > 0) {
                    const rateLimitKey = {
                        performanceStartDate: performanceStartDate,
                        ticketTypeCategory: tmpReservation.ticket_ttts_extension.category,
                        unitInSeconds: tmpReservation.rate_limit_unit_in_seconds
                    };
                    const holder = await ticketTypeCategoryRateLimitRepo.getHolder(rateLimitKey);
                    if (holder === transaction.id) {
                        debug('resetting wheelchair rate limit...');
                        await ticketTypeCategoryRateLimitRepo.unlock(rateLimitKey);
                        debug('wheelchair rate limit reset.');
                    }
                }
            }));

            // 集計タスク作成
            const aggregateTask: factory.task.aggregateEventReservations.IAttributes = {
                name: factory.taskName.AggregateEventReservations,
                status: factory.taskStatus.Ready,
                runsAt: new Date(),
                remainingNumberOfTries: 3,
                // tslint:disable-next-line:no-null-keyword
                lastTriedAt: null,
                numberOfTried: 0,
                executionResults: [],
                data: { id: performance.id }
            };
            await taskRepo.save(aggregateTask);
        } catch (error) {
            // no op
        }
    };
}

/**
 * 仮予約データから在庫確保を取り消す
 */
function removeTmpReservations(
    tmpReservations: factory.action.authorize.seatReservation.ITmpReservation[],
    performance: factory.performance.IPerformanceWithDetails
) {
    return async (repos: {
        stock: StockRepo;
    }) => {
        const section = performance.screen.sections[0];
        await Promise.all(tmpReservations.map(async (tmpReservation) => {
            await Promise.all(tmpReservation.stocks.map(async (stock) => {
                try {
                    const lockKey = {
                        eventId: performance.id,
                        offer: {
                            seatNumber: stock.seat_code,
                            seatSection: section.code
                        }
                    };
                    const holder = await repos.stock.getHolder(lockKey);
                    if (holder === stock.holder) {
                        await repos.stock.unlock(lockKey);
                    }
                } catch (error) {
                    // no op
                }
            }));
        }));
    };
}
