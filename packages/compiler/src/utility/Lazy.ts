export class Lazy<T> {
    private _instance: T | undefined = undefined;

    constructor(private readonly initFunc: () => T) { }

    get instance() {
        return this._instance || (this._instance = this.initFunc());
    }
}
