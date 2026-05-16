"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const workflow_manager_1 = require("../src/daemon/workflow-manager");
describe('WorkflowManager', () => {
    let workflowManager;
    beforeEach(() => {
        workflowManager = new workflow_manager_1.WorkflowManager();
    });
    describe('parseTasks', () => {
        it('should correctly parse tasks and their status', () => {
            const content = `
# Project Tasks
- [x] Task 1: Completed
- [ ] Task 2: Pending
- [X] Task 3: Also Completed
- [ ] Task 4: Another Pending
      `;
            const tasks = workflowManager.parseTasks(content);
            expect(tasks).toHaveLength(4);
            expect(tasks[0]).toEqual({ completed: true, description: 'Task 1: Completed' });
            expect(tasks[1]).toEqual({ completed: false, description: 'Task 2: Pending' });
            expect(tasks[2]).toEqual({ completed: true, description: 'Task 3: Also Completed' });
            expect(tasks[3]).toEqual({ completed: false, description: 'Task 4: Another Pending' });
        });
        it('should return empty array if no tasks found', () => {
            const content = '# No tasks here';
            const tasks = workflowManager.parseTasks(content);
            expect(tasks).toHaveLength(0);
        });
    });
});
//# sourceMappingURL=workflow-manager.test.js.map