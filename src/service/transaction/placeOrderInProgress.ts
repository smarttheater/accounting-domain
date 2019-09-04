/**
 * 進行中注文取引サービス
 */
import * as cinerino from '@cinerino/domain';
import * as factory from '@tokyotower/factory';
import * as waiter from '@waiter/domain';
// import * as createDebug from 'debug';
import { PhoneNumberFormat, PhoneNumberUtil } from 'google-libphonenumber';
import * as moment from 'moment-timezone';

import { RedisRepository as TokenRepo } from '../../repo/token';
import { MongoRepository as TransactionRepo } from '../../repo/transaction';

import * as SeatReservationAuthorizeActionService from './placeOrderInProgress/action/authorize/seatReservation';

const project = { typeOf: <'Project'>'Project', id: <string>process.env.PROJECT_ID };

export type IStartOperation<T> = (
    transactionRepo: TransactionRepo,
    sellerRepo: cinerino.repository.Seller
) => Promise<T>;
export type ITransactionOperation<T> = (transactionRepo: TransactionRepo) => Promise<T>;
export type IConfirmOperation<T> = (repos: {
    action: cinerino.repository.Action;
    orderNumber: cinerino.repository.OrderNumber;
    transaction: TransactionRepo;
    token: TokenRepo;
}) => Promise<T>;

/**
 * 取引開始パラメーターインターフェース
 */
export interface IStartParams {
    /**
     * 取引期限
     */
    expires: Date;
    /**
     * 取引主体
     */
    agent: factory.person.IPerson;
    /**
     * 販売者識別子
     */
    sellerIdentifier: string;
    /**
     * APIクライアント
     */
    clientUser: factory.clientUser.IClientUser;
    /**
     * WAITER許可証トークン
     */
    passportToken?: waiter.factory.passport.IEncodedPassport;
}

/**
 * 取引開始
 */
export function start(params: IStartParams): IStartOperation<factory.transaction.placeOrder.ITransaction> {
    return async (transactionRepo: TransactionRepo, sellerRepo: cinerino.repository.Seller) => {
        // 販売者を取得
        const doc = await sellerRepo.organizationModel.findOne({
            identifier: params.sellerIdentifier
        })
            .exec();
        if (doc === null) {
            throw new factory.errors.NotFound('Seller');
        }

        const seller = <factory.seller.IOrganization<factory.seller.IAttributes<factory.organizationType.Corporation>>>doc.toObject();

        let passport: waiter.factory.passport.IPassport | undefined;

        // WAITER許可証トークンがあれば検証する
        if (params.passportToken !== undefined) {
            try {
                passport = await waiter.service.passport.verify({
                    token: params.passportToken,
                    secret: <string>process.env.WAITER_SECRET
                });
            } catch (error) {
                throw new factory.errors.Argument('passportToken', `Invalid token. ${error.message}`);
            }

            // スコープを判別
            if (seller.identifier === undefined || !validatePassport(passport, seller.identifier)) {
                throw new factory.errors.Argument('passportToken', 'Invalid passport.');
            }
        }

        // 新しい進行中取引を作成
        const transactionAttributes: factory.transaction.placeOrder.IAttributes = {
            project: project,
            typeOf: factory.transactionType.PlaceOrder,
            status: factory.transactionStatusType.InProgress,
            agent: params.agent,
            seller: {
                typeOf: seller.typeOf,
                id: seller.id,
                name: seller.name,
                url: seller.url
            },
            object: {
                passportToken: params.passportToken,
                passport: passport,
                clientUser: params.clientUser,
                authorizeActions: []
            },
            expires: params.expires,
            startDate: new Date(),
            tasksExportationStatus: factory.transactionTasksExportationStatus.Unexported
        };

        let transaction: factory.transaction.placeOrder.ITransaction;
        try {
            transaction = <any>await transactionRepo.start(<any>transactionAttributes);
        } catch (error) {
            if (error.name === 'MongoError') {
                // 許可証を重複使用しようとすると、MongoDBでE11000 duplicate key errorが発生する
                // name: 'MongoError',
                // message: 'E11000 duplicate key error collection: ttts-development-v2.transactions...',
                // code: 11000,

                // tslint:disable-next-line:no-single-line-block-comment
                /* istanbul ignore else */
                // tslint:disable-next-line:no-magic-numbers
                if (error.code === 11000) {
                    throw new factory.errors.AlreadyInUse('transaction', ['passportToken'], 'Passport already used.');
                }
            }

            throw error;
        }

        return transaction;
    };
}

/**
 * WAITER許可証の有効性チェック
 * @param passport WAITER許可証
 * @param sellerIdentifier 販売者識別子
 */
function validatePassport(passport: waiter.factory.passport.IPassport, sellerIdentifier: string) {
    const WAITER_PASSPORT_ISSUER = process.env.WAITER_PASSPORT_ISSUER;
    if (WAITER_PASSPORT_ISSUER === undefined) {
        throw new Error('WAITER_PASSPORT_ISSUER unset');
    }
    const issuers = WAITER_PASSPORT_ISSUER.split(',');
    const validIssuer = issuers.indexOf(passport.iss) >= 0;

    // スコープのフォーマットは、placeOrderTransaction.{sellerId}
    const explodedScopeStrings = passport.scope.split('.');
    const validScope = (
        explodedScopeStrings[0] === 'placeOrderTransaction' && // スコープ接頭辞確認
        explodedScopeStrings[1] === sellerIdentifier // 販売者識別子確認
    );

    return validIssuer && validScope;
}

/**
 * 取引に対するアクション
 */
export namespace action {
    /**
     * 取引に対する承認アクション
     */
    export namespace authorize {
        /**
         * 座席予約承認アクションサービス
         */
        export import seatReservation = SeatReservationAuthorizeActionService;
    }
}

/**
 * 取引中の購入者情報を変更する
 */
export function setCustomerContact(
    agentId: string,
    transactionId: string,
    contact: factory.transaction.placeOrder.ICustomerProfile
): ITransactionOperation<factory.transaction.placeOrder.ICustomerProfile> {
    return async (transactionRepo: TransactionRepo) => {
        let formattedTelephone: string;
        try {
            const phoneUtil = PhoneNumberUtil.getInstance();
            // addressが国コード
            const phoneNumber = phoneUtil.parse(contact.telephone, contact.address);
            if (!phoneUtil.isValidNumber(phoneNumber)) {
                throw new Error('invalid phone number format.');
            }

            formattedTelephone = phoneUtil.format(phoneNumber, PhoneNumberFormat.E164);
        } catch (error) {
            throw new factory.errors.Argument('contact.telephone', error.message);
        }

        // 連絡先を再生成(validationの意味も含めて)
        const profile: factory.transaction.placeOrder.ICustomerProfile = {
            email: contact.email,
            age: contact.age,
            address: contact.address,
            gender: contact.gender,
            givenName: contact.givenName,
            familyName: contact.familyName,
            telephone: formattedTelephone
        };

        const transaction = await transactionRepo.findInProgressById({ typeOf: factory.transactionType.PlaceOrder, id: transactionId });

        if (transaction.agent.id !== agentId) {
            throw new factory.errors.Forbidden('A specified transaction is not yours.');
        }

        await transactionRepo.updateCustomerProfile({
            typeOf: transaction.typeOf,
            id: transaction.id,
            agent: profile
        });

        return profile;
    };
}

/**
 * 取引確定
 */
export function confirm(params: {
    id: string;
    agent?: {
        id?: string;
    };
    /**
     * 取引確定後アクション
     */
    potentialActions?: factory.transaction.placeOrder.IConfirmPotentialActionsParams;
    result: {
        order: {
            orderDate: Date;
            /**
             * 確認番号のカスタム指定
             */
            confirmationNumber?: string;
        };
    };
}): IConfirmOperation<factory.transaction.placeOrder.IResult> {
    return async (repos: {
        action: cinerino.repository.Action;
        orderNumber: cinerino.repository.OrderNumber;
        token: TokenRepo;
        transaction: TransactionRepo;
    }) => {
        const transaction = await repos.transaction.findInProgressById({ typeOf: factory.transactionType.PlaceOrder, id: params.id });

        if (params.agent !== undefined && typeof params.agent.id === 'string') {
            if (transaction.agent.id !== params.agent.id) {
                throw new factory.errors.Forbidden('A specified transaction is not yours');
            }
        }

        // 取引に対する全ての承認アクションをマージ
        let authorizeActions = await repos.action.searchByPurpose({
            typeOf: factory.actionType.AuthorizeAction,
            purpose: {
                typeOf: factory.transactionType.PlaceOrder,
                id: params.id
            }
        });

        // 万が一このプロセス中に他処理が発生してもそれらを無視するように、endDateでフィルタリング
        authorizeActions = authorizeActions.filter((a) => (a.endDate !== undefined && a.endDate < params.result.order.orderDate));
        transaction.object.authorizeActions = authorizeActions;

        // 注文取引成立条件を満たしているかどうか
        if (!canBeClosed(transaction)) {
            throw new factory.errors.Argument('transactionId', 'Transaction cannot be confirmed because prices are not matched.');
        }

        const orderNumber = await repos.orderNumber.publishByTimestamp({
            project: project,
            orderDate: params.result.order.orderDate
        });

        // 確認番号を発行
        let confirmationNumber = '0';

        // 確認番号の指定があれば上書き
        // tslint:disable-next-line:no-single-line-block-comment
        /* istanbul ignore if */
        if (typeof params.result.order.confirmationNumber === 'string') {
            confirmationNumber = params.result.order.confirmationNumber;
        }

        // 注文作成
        const { order } = createResult(confirmationNumber, orderNumber, transaction);

        const result: factory.transaction.placeOrder.IResult = { order };

        const potentialActions = await createPotentialActionsFromTransaction({
            transaction: transaction,
            order: order,
            potentialActions: params.potentialActions
        });

        // 印刷トークンを発行
        const printToken = await repos.token.createPrintToken(
            order.acceptedOffers.map((o) => (<factory.cinerino.order.IReservation>o.itemOffered).id)
        );

        // ステータス変更
        try {
            await repos.transaction.confirm({
                typeOf: transaction.typeOf,
                id: transaction.id,
                authorizeActions: authorizeActions,
                result: result,
                potentialActions: potentialActions
            });
        } catch (error) {
            if (error.name === 'MongoError') {
                // 万が一同一注文番号で確定しようとすると、MongoDBでE11000 duplicate key errorが発生する
                // name: 'MongoError',
                // message: 'E11000 duplicate key error collection: prodttts.transactions index:result.order.orderNumber_1 dup key:...',
                // code: 11000,
                // tslint:disable-next-line:no-magic-numbers
                if (error.code === 11000) {
                    throw new factory.errors.AlreadyInUse('transaction', ['result.order.orderNumber']);
                }
            }

            throw error;
        }

        return {
            order: order,
            printToken: printToken
        };
    };
}

/**
 * 取引が確定可能な状態かどうかをチェックする
 */
function canBeClosed(
    transaction: factory.transaction.placeOrder.ITransaction
) {
    // customerとsellerで、承認アクションの金額が合うかどうか
    const priceByAgent = transaction.object.authorizeActions
        .filter((a) => a.actionStatus === factory.actionStatusType.CompletedActionStatus)
        .filter((a) => a.agent.id === transaction.agent.id)
        .reduce((a, b) => a + Number((<factory.action.authorize.creditCard.IResult>b.result).amount), 0);
    const priceBySeller = transaction.object.authorizeActions
        .filter((a) => a.actionStatus === factory.actionStatusType.CompletedActionStatus)
        .filter((a) => a.agent.id === transaction.seller.id)
        .reduce((a, b) => a + (<factory.action.authorize.seatReservation.IResult>b.result).price, 0);

    if (priceByAgent !== priceBySeller) {
        throw new factory.errors.Argument('transactionId', 'Prices not matched between an agent and a seller.');
    }

    return true;
}

/**
 * 注文取引結果を作成する
 */
// tslint:disable-next-line:max-func-body-length
export function createResult(
    confirmationNumber: string,
    orderNumber: string,
    transaction: factory.transaction.placeOrder.ITransaction
): factory.transaction.placeOrder.IResult {
    // tslint:disable-next-line:no-magic-numbers
    const paymentNo = confirmationNumber.slice(-6);

    const seatReservationAuthorizeAction = <factory.action.authorize.seatReservation.IAction>transaction.object.authorizeActions
        .filter((a) => a.actionStatus === factory.actionStatusType.CompletedActionStatus)
        .find((a) => a.object.typeOf === factory.action.authorize.seatReservation.ObjectType.SeatReservation);
    const creditCardAuthorizeAction = <factory.action.authorize.creditCard.IAction | undefined>transaction.object.authorizeActions
        .filter((a) => a.actionStatus === factory.actionStatusType.CompletedActionStatus)
        .find((a) => a.object.typeOf === factory.paymentMethodType.CreditCard);

    const authorizeSeatReservationResult = <factory.action.authorize.seatReservation.IResult>seatReservationAuthorizeAction.result;
    const reserveTransaction = authorizeSeatReservationResult.responseBody;
    if (reserveTransaction === undefined) {
        throw new factory.errors.Argument('Transaction', 'Reserve Transaction undefined');
    }

    const tmpReservations = (<factory.action.authorize.seatReservation.IResult>seatReservationAuthorizeAction.result).tmpReservations;
    const chevreReservations = reserveTransaction.object.reservations;

    const profile = transaction.agent;

    const orderDate = new Date();

    // 注文番号を作成
    let paymentMethodId = '';
    if (creditCardAuthorizeAction !== undefined && creditCardAuthorizeAction.result !== undefined) {
        paymentMethodId = creditCardAuthorizeAction.result.paymentMethodId;
    }

    const paymentMethods: factory.order.IPaymentMethod<factory.cinerino.paymentMethodType>[] = [];

    // 決済方法をセット
    Object.keys(factory.cinerino.paymentMethodType)
        .forEach((key) => {
            const paymentMethodType = <factory.cinerino.paymentMethodType>(<any>factory.cinerino.paymentMethodType)[key];
            transaction.object.authorizeActions
                .filter((a) => a.actionStatus === factory.actionStatusType.CompletedActionStatus)
                .filter((a) => a.result !== undefined && a.result.paymentMethod === paymentMethodType)
                .forEach((a: any) => {
                    const authorizePaymentMethodAction =
                        <factory.cinerino.action.authorize.paymentMethod.any.IAction<factory.cinerino.paymentMethodType>>a;
                    const result = (<factory.cinerino.action.authorize.paymentMethod.any.IResult<factory.cinerino.paymentMethodType>>
                        authorizePaymentMethodAction.result);
                    paymentMethods.push({
                        accountId: result.accountId,
                        additionalProperty: (Array.isArray(result.additionalProperty)) ? result.additionalProperty : [],
                        name: result.name,
                        paymentMethodId: result.paymentMethodId,
                        totalPaymentDue: result.totalPaymentDue,
                        typeOf: paymentMethodType
                    });
                });
        });

    // 予約データを作成
    const eventReservations = tmpReservations.map((tmpReservation, index) => {
        const chevreReservation = chevreReservations.find((r) => r.id === tmpReservation.id);
        if (chevreReservation === undefined) {
            throw new factory.errors.Argument('Transaction', `Unexpected temporary reservation: ${tmpReservation.id}`);
        }

        return temporaryReservation2confirmed({
            tmpReservation: tmpReservation,
            chevreReservation: chevreReservation,
            transaction: transaction,
            orderNumber: orderNumber,
            paymentNo: paymentNo,
            gmoOrderId: paymentMethodId,
            paymentSeatIndex: index.toString(),
            customer: profile,
            bookingTime: orderDate,
            paymentMethodName: paymentMethods[0].name
        });
    });

    const acceptedOffers: factory.order.IAcceptedOffer<factory.order.IItemOffered>[] = eventReservations.map((r) => {
        const unitPrice = (r.reservedTicket.ticketType.priceSpecification !== undefined)
            ? r.reservedTicket.ticketType.priceSpecification.price
            : 0;

        return {
            typeOf: 'Offer',
            itemOffered: r,
            price: unitPrice,
            priceCurrency: factory.priceCurrency.JPY,
            seller: {
                typeOf: transaction.seller.typeOf,
                name: transaction.seller.name.ja
            }
        };
    });

    const price: number = eventReservations.reduce(
        (a, b) => {
            const unitPrice = (b.reservedTicket.ticketType.priceSpecification !== undefined)
                ? b.reservedTicket.ticketType.priceSpecification.price
                : 0;

            return a + unitPrice;
        },
        0
    );

    const customerIdentifier = (Array.isArray(transaction.agent.identifier)) ? transaction.agent.identifier : [];
    const customer: factory.order.ICustomer = {
        ...profile,
        id: transaction.agent.id,
        typeOf: transaction.agent.typeOf,
        name: `${profile.givenName} ${profile.familyName}`,
        url: '',
        identifier: customerIdentifier
    };

    return {
        order: {
            project: project,
            typeOf: 'Order',
            seller: {
                id: transaction.seller.id,
                typeOf: transaction.seller.typeOf,
                name: transaction.seller.name.ja,
                url: (transaction.seller.url !== undefined) ? transaction.seller.url : ''
            },
            customer: customer,
            acceptedOffers: acceptedOffers,
            confirmationNumber: confirmationNumber,
            orderNumber: orderNumber,
            price: price,
            priceCurrency: factory.priceCurrency.JPY,
            paymentMethods: paymentMethods,
            discounts: [],
            url: '',
            orderStatus: factory.orderStatus.OrderDelivered,
            orderDate: orderDate,
            isGift: false
        }
    };
}

/**
 * 仮予約から確定予約を生成する
 */
function temporaryReservation2confirmed(params: {
    tmpReservation: factory.action.authorize.seatReservation.ITmpReservation;
    chevreReservation: factory.chevre.reservation.IReservation<factory.chevre.reservationType.EventReservation>;
    transaction: factory.transaction.placeOrder.ITransaction;
    orderNumber: string;
    paymentNo: string;
    gmoOrderId: string;
    paymentSeatIndex: string;
    customer: factory.transaction.placeOrder.IAgent;
    bookingTime: Date;
    paymentMethodName: string;
}): factory.chevre.reservation.IReservation<factory.chevre.reservationType.EventReservation> {
    const transaction = params.transaction;
    const customer = params.customer;

    const underName: factory.chevre.reservation.IUnderName<factory.chevre.reservationType.EventReservation> = {
        typeOf: factory.personType.Person,
        id: params.transaction.agent.id,
        name: `${customer.givenName} ${customer.familyName}`,
        familyName: customer.familyName,
        givenName: customer.givenName,
        email: customer.email,
        telephone: customer.telephone,
        gender: customer.gender,
        identifier: [
            { name: 'orderNumber', value: params.orderNumber },
            { name: 'paymentNo', value: params.paymentNo },
            { name: 'transaction', value: transaction.id },
            { name: 'gmoOrderId', value: params.gmoOrderId },
            ...(typeof customer.age === 'string')
                ? [{ name: 'age', value: customer.age }]
                : [],
            ...(transaction.agent.identifier !== undefined) ? transaction.agent.identifier : [],
            ...(transaction.agent.memberOf !== undefined && transaction.agent.memberOf.membershipNumber !== undefined)
                ? [{ name: 'username', value: transaction.agent.memberOf.membershipNumber }]
                : [],
            ...(params.paymentMethodName !== undefined)
                ? [{ name: 'paymentMethod', value: params.paymentMethodName }]
                : []
        ],
        ...{ address: customer.address }
    };

    return {
        ...params.chevreReservation,

        reservationFor: {
            ...params.chevreReservation.reservationFor,
            doorTime: moment(params.chevreReservation.reservationFor.doorTime).toDate(),
            endDate: moment(params.chevreReservation.reservationFor.endDate).toDate(),
            startDate: moment(params.chevreReservation.reservationFor.startDate).toDate()
        },
        bookingTime: moment(params.bookingTime).toDate(),
        reservationStatus: factory.chevre.reservationStatusType.ReservationConfirmed,
        underName: underName,
        additionalProperty: [
            ...(Array.isArray(params.tmpReservation.additionalProperty)) ? params.tmpReservation.additionalProperty : [],
            { name: 'paymentSeatIndex', value: params.paymentSeatIndex }
        ],
        additionalTicketText: params.tmpReservation.additionalTicketText
    };
}

export type IAuthorizeSeatReservationOffer =
    factory.cinerino.action.authorize.offer.seatReservation.IAction<factory.cinerino.service.webAPI.Identifier>;

/**
 * 取引のポストアクションを作成する
 */
// tslint:disable-next-line:max-func-body-length
export async function createPotentialActionsFromTransaction(params: {
    transaction: factory.transaction.placeOrder.ITransaction;
    order: factory.order.IOrder;
    potentialActions?: factory.transaction.placeOrder.IConfirmPotentialActionsParams;
}): Promise<factory.cinerino.transaction.placeOrder.IPotentialActions> {
    // クレジットカード支払いアクション
    const authorizeCreditCardActions = <factory.action.authorize.creditCard.IAction[]>
        params.transaction.object.authorizeActions
            .filter((a) => a.actionStatus === factory.actionStatusType.CompletedActionStatus)
            .filter((a) => a.result !== undefined)
            .filter((a) => a.result.paymentMethod === factory.paymentMethodType.CreditCard);
    const seatReservationAuthorizeActions = <IAuthorizeSeatReservationOffer[]>
        params.transaction.object.authorizeActions
            .filter((a) => a.actionStatus === factory.actionStatusType.CompletedActionStatus)
            .filter((a) => a.object.typeOf === factory.cinerino.action.authorize.offer.seatReservation.ObjectType.SeatReservation);

    const payCreditCardActions: factory.cinerino.action.trade.pay.IAttributes<factory.cinerino.paymentMethodType.CreditCard>[] = [];
    authorizeCreditCardActions.forEach((a) => {
        const result = <factory.cinerino.action.authorize.paymentMethod.creditCard.IResult>a.result;
        if (result.paymentStatus === factory.cinerino.paymentStatusType.PaymentDue) {
            payCreditCardActions.push({
                project: params.transaction.project,
                typeOf: <factory.actionType.PayAction>factory.actionType.PayAction,
                object: [{
                    typeOf: <factory.cinerino.action.trade.pay.TypeOfObject>'PaymentMethod',
                    paymentMethod: {
                        accountId: result.accountId,
                        additionalProperty: (Array.isArray(result.additionalProperty)) ? result.additionalProperty : [],
                        name: result.name,
                        paymentMethodId: result.paymentMethodId,
                        totalPaymentDue: result.totalPaymentDue,
                        typeOf: <factory.cinerino.paymentMethodType.CreditCard>result.paymentMethod
                    },
                    price: result.amount,
                    priceCurrency: factory.priceCurrency.JPY,
                    entryTranArgs: result.entryTranArgs,
                    execTranArgs: result.execTranArgs
                }],
                agent: params.transaction.agent,
                purpose: {
                    typeOf: params.order.typeOf,
                    seller: params.order.seller,
                    customer: params.order.customer,
                    confirmationNumber: params.order.confirmationNumber,
                    orderNumber: params.order.orderNumber,
                    price: params.order.price,
                    priceCurrency: params.order.priceCurrency,
                    orderDate: params.order.orderDate
                }
            });
        }
    });

    const confirmReservationActions:
        factory.cinerino.action.interact.confirm.reservation.IAttributes<factory.cinerino.service.webAPI.Identifier>[] = [];
    let confirmReservationParams: factory.transaction.placeOrder.IConfirmReservationParams[] = [];
    if (params.potentialActions !== undefined
        && params.potentialActions.order !== undefined
        && params.potentialActions.order.potentialActions !== undefined
        && params.potentialActions.order.potentialActions.sendOrder !== undefined
        && params.potentialActions.order.potentialActions.sendOrder.potentialActions !== undefined
        && Array.isArray(params.potentialActions.order.potentialActions.sendOrder.potentialActions.confirmReservation)) {
        confirmReservationParams =
            params.potentialActions.order.potentialActions.sendOrder.potentialActions.confirmReservation;
    }

    // tslint:disable-next-line:max-func-body-length
    seatReservationAuthorizeActions.forEach((a) => {
        const actionResult = a.result;

        if (a.instrument === undefined) {
            a.instrument = {
                typeOf: 'WebAPI',
                identifier: factory.cinerino.service.webAPI.Identifier.Chevre
            };
        }

        if (actionResult !== undefined) {
            const responseBody = actionResult.responseBody;

            switch (a.instrument.identifier) {
                default:
                    // tslint:disable-next-line:max-line-length
                    // responseBody = <factory.cinerino.action.authorize.offer.seatReservation.IResponseBody<factory.cinerino.service.webAPI.Identifier.Chevre>>responseBody;
                    // tslint:disable-next-line:max-line-length
                    const reserveTransaction = <factory.cinerino.action.authorize.offer.seatReservation.IResponseBody<factory.cinerino.service.webAPI.Identifier.Chevre>>responseBody;
                    const chevreReservations = reserveTransaction.object.reservations;
                    const defaultUnderNameIdentifiers: factory.propertyValue.IPropertyValue<string>[]
                        = [{ name: 'orderNumber', value: params.order.orderNumber }];

                    const confirmReservationObject:
                        factory.cinerino.action.interact.confirm.reservation.IObject<factory.cinerino.service.webAPI.Identifier.Chevre> = {
                        typeOf: factory.chevre.transactionType.Reserve,
                        id: reserveTransaction.id,
                        object: {
                            reservations: [
                                ...params.order.acceptedOffers.map((o) => <factory.cinerino.order.IReservation>o.itemOffered)
                                    .map((r) => {
                                        // プロジェクト固有の値を連携
                                        return {
                                            id: r.id,
                                            additionalTicketText: r.additionalTicketText,
                                            reservedTicket: {
                                                issuedBy: r.reservedTicket.issuedBy,
                                                ticketToken: r.reservedTicket.ticketToken,
                                                underName: r.reservedTicket.underName
                                            },
                                            underName: r.underName,
                                            additionalProperty: r.additionalProperty
                                        };
                                    }),
                                // 余分確保分の予約にもextraプロパティを連携
                                ...chevreReservations.filter((r) => {
                                    // 注文アイテムに存在しない予約(余分確保分)にフィルタリング
                                    const orderItem = params.order.acceptedOffers.find(
                                        (o) => (<factory.cinerino.order.IReservation>o.itemOffered).id === r.id
                                    );

                                    return orderItem === undefined;
                                })
                                    .map((r) => {
                                        return {
                                            id: r.id,
                                            additionalProperty: [
                                                { name: 'extra', value: '1' }
                                            ]
                                        };
                                    })
                            ]
                        }
                    };

                    const confirmReservationObjectParams = confirmReservationParams.find((p) => {
                        const object = <factory.cinerino.action.interact.confirm.reservation.IObject4Chevre>p.object;

                        return object !== undefined
                            && object.typeOf === factory.chevre.transactionType.Reserve
                            && object.id === reserveTransaction.id;
                    });
                    // 予約確定パラメータの指定があれば上書きする
                    if (confirmReservationObjectParams !== undefined) {
                        const customizedConfirmReservationObject =
                            <factory.cinerino.action.interact.confirm.reservation.IObject4Chevre>confirmReservationObjectParams.object;

                        // 予約取引確定オブジェクトの指定があれば上書き
                        if (customizedConfirmReservationObject.object !== undefined) {
                            if (Array.isArray(customizedConfirmReservationObject.object.reservations)) {
                                customizedConfirmReservationObject.object.reservations.forEach((r) => {
                                    if (r.underName !== undefined && Array.isArray(r.underName.identifier)) {
                                        r.underName.identifier.push(...defaultUnderNameIdentifiers);
                                    }

                                    if (r.reservedTicket !== undefined
                                        && r.reservedTicket.underName !== undefined
                                        && Array.isArray(r.reservedTicket.underName.identifier)) {
                                        r.reservedTicket.underName.identifier.push(...defaultUnderNameIdentifiers);
                                    }
                                });
                            }

                            confirmReservationObject.object = customizedConfirmReservationObject.object;
                        }

                        // 予約取引確定後アクションの指定があれば上書き
                        const confirmReservePotentialActions = customizedConfirmReservationObject.potentialActions;
                        if (confirmReservePotentialActions !== undefined
                            && confirmReservePotentialActions.reserve !== undefined
                            && confirmReservePotentialActions.reserve.potentialActions !== undefined
                            && Array.isArray(confirmReservePotentialActions.reserve.potentialActions.informReservation)) {
                            confirmReservationObject.potentialActions = {
                                reserve: {
                                    potentialActions: {
                                        informReservation: confirmReservePotentialActions.reserve.potentialActions.informReservation
                                    }
                                }
                            };
                        }
                    }

                    confirmReservationActions.push({
                        project: params.transaction.project,
                        typeOf: <factory.actionType.ConfirmAction>factory.actionType.ConfirmAction,
                        object: confirmReservationObject,
                        agent: params.transaction.agent,
                        purpose: {
                            typeOf: params.order.typeOf,
                            seller: params.order.seller,
                            customer: params.order.customer,
                            confirmationNumber: params.order.confirmationNumber,
                            orderNumber: params.order.orderNumber,
                            price: params.order.price,
                            priceCurrency: params.order.priceCurrency,
                            orderDate: params.order.orderDate
                        },
                        instrument: a.instrument
                    });
            }
        }
    });

    const informOrderActionsOnPlaceOrder: factory.cinerino.action.interact.inform.IAttributes<any, any>[] = [];
    if (params.potentialActions !== undefined) {
        if (params.potentialActions.order !== undefined) {
            if (params.potentialActions.order.potentialActions !== undefined) {
                if (Array.isArray(params.potentialActions.order.potentialActions.informOrder)) {
                    params.potentialActions.order.potentialActions.informOrder.forEach((a) => {
                        if (a.recipient !== undefined) {
                            if (typeof a.recipient.url === 'string') {
                                informOrderActionsOnPlaceOrder.push({
                                    agent: params.transaction.seller,
                                    object: params.order,
                                    project: params.transaction.project,
                                    // purpose: params.transaction,
                                    recipient: {
                                        id: params.transaction.agent.id,
                                        name: params.transaction.agent.name,
                                        typeOf: params.transaction.agent.typeOf,
                                        url: a.recipient.url
                                    },
                                    typeOf: factory.actionType.InformAction
                                });
                            }
                        }
                    });
                }
            }
        }
    }

    const sendOrderActionAttributes: factory.cinerino.action.transfer.send.order.IAttributes = {
        project: params.transaction.project,
        typeOf: factory.actionType.SendAction,
        object: params.order,
        agent: params.transaction.seller,
        recipient: params.transaction.agent,
        potentialActions: {
            confirmReservation: confirmReservationActions
            // sendEmailMessage: (sendEmailMessageActionAttributes !== null) ? sendEmailMessageActionAttributes : undefined,
        }
    };

    return {
        order: {
            project: params.transaction.project,
            typeOf: factory.actionType.OrderAction,
            object: params.order,
            agent: params.transaction.agent,
            potentialActions: {
                informOrder: informOrderActionsOnPlaceOrder,
                payCreditCard: payCreditCardActions,
                sendOrder: sendOrderActionAttributes
            },
            purpose: {
                typeOf: params.transaction.typeOf,
                id: params.transaction.id
            }
        }
    };
}
