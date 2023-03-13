import { equal } from 'assert';
import 'mocha';
import { createContractProject } from '../utils'

export function createTestProject(source: string) {
    const project = createContractProject();
    const sourceFile = project.createSourceFile("contract.ts", source);
    return { project, sourceFile };
}

describe('Array', function () {
    describe('#indexOf()', function () {
        it('should return -1 when the value is not present', function () {

            
            equal([1, 2, 3].indexOf(4), -1);
        });
    });
});