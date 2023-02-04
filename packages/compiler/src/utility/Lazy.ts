export class Lazy<T> {
    private _instance: T | undefined = undefined;

    constructor(private readonly initFunc: () => T) { }

    get() {
        return this._instance || (this._instance = this.initFunc());
    }
}

export class AsyncLazy<T> {
    private _instance: T | undefined = undefined;

    constructor(private readonly initFunc: () => T | Promise<T>) { }

    async get() {
        if (!this._instance) {
            this._instance = await this.initFunc();
        }
        return this._instance;
    }
}