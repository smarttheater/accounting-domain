// tslint:disable:no-implicit-dependencies
/**
 * task repository test
 */
import { } from 'mocha';
import * as mongoose from 'mongoose';
import * as assert from 'power-assert';
import * as sinon from 'sinon';
// tslint:disable-next-line:no-require-imports no-var-requires
require('sinon-mongoose');
import * as ttts from '../index';

let sandbox: sinon.SinonSandbox;

before(() => {
    sandbox = sinon.sandbox.create();
});

describe('save()', () => {
    afterEach(() => {
        sandbox.restore();
    });

    it('MongoDBの状態が正常であれば、保管できるはず', async () => {
        const ownershipInfo = {};

        const repository = new ttts.repository.Task(mongoose.connection);

        sandbox.mock(repository.taskModel).expects('create').once()
            .resolves(new repository.taskModel());

        const result = await repository.save(<any>ownershipInfo);

        assert.equal(typeof result, 'object');
        sandbox.verify();
    });
});

describe('executeOneByName()', () => {
    afterEach(() => {
        sandbox.restore();
    });

    it('MongoDBの状態が正常であれば、オブジェクトが返却されるはず', async () => {
        const taskName = ttts.factory.taskName.SettleCreditCard;

        const repository = new ttts.repository.Task(mongoose.connection);

        sandbox.mock(repository.taskModel).expects('findOneAndUpdate').once()
            .chain('exec').resolves(new repository.taskModel());

        const result = await repository.executeOneByName(taskName);

        assert.equal(typeof result, 'object');
        sandbox.verify();
    });

    it('存在しなければ、nullが返却されるはず', async () => {
        const taskName = ttts.factory.taskName.SettleCreditCard;

        const repository = new ttts.repository.Task(mongoose.connection);

        sandbox.mock(repository.taskModel).expects('findOneAndUpdate').once()
            .chain('exec').resolves(null);

        const result = await repository.executeOneByName(taskName);
        assert(result === null);
        sandbox.verify();
    });
});

describe('retry()', () => {
    afterEach(() => {
        sandbox.restore();
    });

    it('MongoDBの状態が正常であれば、成功するはず', async () => {
        const intervalInMinutes = 10;

        const repository = new ttts.repository.Task(mongoose.connection);

        sandbox.mock(repository.taskModel).expects('update').once()
            .chain('exec').resolves();

        const result = await repository.retry(intervalInMinutes);

        assert.equal(result, undefined);
        sandbox.verify();
    });
});

describe('abortOne()', () => {
    afterEach(() => {
        sandbox.restore();
    });

    it('MongoDBの状態が正常であれば、オブジェクトが返却されるはず', async () => {
        const intervalInMinutes = 10;

        const repository = new ttts.repository.Task(mongoose.connection);

        sandbox.mock(repository.taskModel).expects('findOneAndUpdate').once()
            .chain('exec').resolves(new repository.taskModel());

        const result = await repository.abortOne(intervalInMinutes);

        assert.equal(typeof result, 'object');
        sandbox.verify();
    });

    it('存在しなければ、nullが返却されるはず', async () => {
        const intervalInMinutes = 10;

        const repository = new ttts.repository.Task(mongoose.connection);
        sandbox.mock(repository.taskModel)
            .expects('findOneAndUpdate')
            .once()
            .chain('exec')
            .resolves(null);

        const result = await repository.abortOne(intervalInMinutes);
        assert(result === null);
        sandbox.verify();
    });
});

describe('pushExecutionResultById()', () => {
    afterEach(() => {
        sandbox.restore();
    });

    it('MongoDBの状態が正常であれば、オブジェクトが返却されるはず', async () => {
        const taskId = 'taskId';
        const status = ttts.factory.taskStatus.Executed;
        const executionResult = {};

        const repository = new ttts.repository.Task(mongoose.connection);

        sandbox.mock(repository.taskModel).expects('findByIdAndUpdate').once()
            .chain('exec').resolves(new repository.taskModel());

        const result = await repository.pushExecutionResultById(taskId, status, <any>executionResult);

        assert.equal(result, undefined);
        sandbox.verify();
    });
});
