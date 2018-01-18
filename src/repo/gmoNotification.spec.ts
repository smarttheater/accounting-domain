// tslint:disable:no-implicit-dependencies

/**
 * gmoNotification repository test
 * @ignore
 */

import { } from 'mocha';
import * as assert from 'power-assert';
import * as sinon from 'sinon';
// tslint:disable-next-line:no-require-imports no-var-requires
require('sinon-mongoose');
import * as ttts from '../index';

let sandbox: sinon.SinonSandbox;

before(() => {
    sandbox = sinon.sandbox.create();
});

describe('constructor()', () => {
    afterEach(() => {
        sandbox.restore();
    });

    it('インスタンス生成できるはず', async () => {
        const creativeWorkRepo = new ttts.repository.GMONotification(ttts.mongoose.connection);

        assert.notEqual(creativeWorkRepo.gmoNotificationModel, undefined);
    });
});

describe('GMONotificationRepo.save()', () => {
    afterEach(() => {
        sandbox.restore();
    });

    it('repositoryの状態が正常であれば、エラーにならないはず', async () => {
        const notification = {};
        const gmoNotificationRepo = new ttts.repository.GMONotification(ttts.mongoose.connection);

        sandbox.mock(gmoNotificationRepo.gmoNotificationModel).expects('create').once().resolves();

        const result = await gmoNotificationRepo.save(<any>notification);
        assert.equal(result, undefined);
        sandbox.verify();
    });
});

describe('GMONotificationRepo.searchSales()', () => {
    afterEach(() => {
        sandbox.restore();
    });

    it('repositoryの状態が正常であれば、配列を取得できるはず', async () => {
        const conditions = {};
        const notifications: any[] = [];
        const gmoNotificationRepo = new ttts.repository.GMONotification(ttts.mongoose.connection);

        sandbox.mock(gmoNotificationRepo.gmoNotificationModel).expects('find').once()
            .chain('lean').chain('exec').resolves(notifications);

        const result = await gmoNotificationRepo.searchSales(<any>conditions);
        assert(Array.isArray(result));
        sandbox.verify();
    });
});