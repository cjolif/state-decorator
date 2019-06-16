import isEqual from 'fast-deep-equal';

import {
  AsynchAction,
  ConflictPolicy,
  AsynchActionPromise,
  AdvancedSynchAction,
  StateDecoratorAction,
  SynchAction,
  PromiseProvider,
} from './types';

export const IS_JEST_ENV = typeof process !== 'undefined' && process && !(process as any).browser;

export function toMap<In, Out = In>(
  arr: In[],
  keyFunc: (item: In) => string = (o) => (o as any).id,
  mapFunc: (item: In, index: number) => Out = (o: In) => (o as unknown) as Out
): {
  [key: string]: Out;
} {
  return arr.reduce(
    (acc, item, index) => {
      const key = keyFunc(item);
      if (key !== null) {
        acc[key] = mapFunc(item, index);
      }
      return acc;
    },
    {} as { [key: string]: Out }
  );
}

export function retryDecorator<S, F extends (...args: any[]) => Promise<any>, A, P>(
  promiseProvider: PromiseProvider<S, F, A, P>,
  maxCalls = 1,
  delay = 1000,
  isRetryError: (e: Error) => boolean = () => true
): PromiseProvider<S, F, A, P> {
  if (maxCalls === 1) {
    return promiseProvider;
  }
  return (args: any, state: S, props: P, actions: A): ReturnType<F> => {
    function call(callCount: number, resolve: (res: any) => any, reject: (e: Error) => any) {
      const p = promiseProvider(args, state, props, actions);

      if (p === null) {
        return null;
      }

      return p.then((res) => resolve(res)).catch((e) => {
        if (isRetryError(e)) {
          if (callCount === maxCalls) {
            reject(e);
          } else {
            setTimeout(call, delay * callCount, callCount + 1, resolve, reject);
          }
        } else {
          reject(e);
        }
      });
    }

    return new Promise((resolve, reject) => {
      call(1, resolve, reject);
    }) as any;
  };
}

/**
 * Type guard function to test if an action is a asynchronous action.
 */
export function isAsyncAction<S, F extends (...args: any[]) => any, A, P>(
  action: StateDecoratorAction<S, F, A, P>
): action is AsynchAction<S, F, A, P> {
  return !(action instanceof Function) && (action.hasOwnProperty('promise') || action.hasOwnProperty('promiseGet'));
}

/**
 * Type guard function to test if an action is a synchronous action.
 */
export function isSyncAction<S, F extends (...args: any[]) => any, A, P>(
  action: StateDecoratorAction<S, F, A, P>
): action is SynchAction<S, F, P> {
  return action instanceof Function;
}

/**
 * Type guard function to test if an action is a synchronous action.
 */
export function isAdvancedSyncAction<S, F extends (...args: any[]) => any, A, P>(
  action: StateDecoratorAction<S, F, A, P>
): action is AdvancedSynchAction<S, F, A, P> {
  return !(action instanceof Function) && !action.hasOwnProperty('promise') && !action.hasOwnProperty('promiseGet');
}

/**
 * Utility to test an asynchronous action.
 * @param action The action to test
 * @param test The test function that takes the discrimined action type and cam return a promise
 */
export function testAsyncAction<S, F extends (...args: any[]) => any, A, P>(
  action: StateDecoratorAction<S, F, A, P>,
  test: (action: AsynchActionPromise<S, F, A, P>) => any | Promise<any>
) {
  if (isAsyncAction(action)) {
    return test(computeAsyncActionInput(action));
  }
  return Promise.reject(new Error('This action is not an asynchronous action'));
}

/**
 * Utility to test an synchronous action.
 * @param action The action to test
 * @param test The test function that takes the discrimined action type and cam return a promise
 */
export function testSyncAction<S, F extends (...args: any[]) => any, A, P>(
  action: StateDecoratorAction<S, F, A, P>,
  test: (action: SynchAction<S, F, P>) => any | Promise<any>
) {
  if (isSyncAction(action)) {
    return test(action);
  }
  return Promise.reject(new Error('This action is not a synchronous action'));
}

/**
 * Utility to test an advanced synchronous action.
 * @param action The action to test
 * @param test The test function that takes the discrimined action type and cam return a promise
 */
export function testAdvancedSyncAction<S, F extends (...args: any[]) => any, A, P>(
  action: StateDecoratorAction<S, F, A, P>,
  test: (action: AdvancedSynchAction<S, F, A, P>) => any | Promise<any>
) {
  if (isAdvancedSyncAction(action)) {
    return test(action);
  }
  return Promise.reject(new Error('This action is not a synchronous advanced action'));
}

/**
 * @private
 */
export function computeAsyncActionInput<S, F extends (...args: any[]) => any, A, P>(
  action: AsynchAction<S, F, A, P>
): AsynchActionPromise<S, F, A, P> {
  if ('promiseGet' in action) {
    return {
      ...action,
      promise: action.promiseGet,
      retryCount: 3,
      conflictPolicy: ConflictPolicy.REUSE,
    };
  }
  return action;
}

export function areSameArgs(args1: any[], args2: any[]): boolean {
  if (args1.length !== args2.length) {
    return false;
  }
  return args1.find((value, index) => args2[index] !== value) == null;
}

function buildDiff<S>(oldState: S, newState: S) {
  const res = {};

  if (process.env.NODE_ENV === 'development') {
    Object.keys(oldState).forEach((k) => {
      if (newState.hasOwnProperty(k)) {
        const oldValue = oldState[k];
        const newValue = newState[k];

        if (newValue !== oldValue) {
          const type = newState[k] == null ? typeof oldState[k] : typeof newState[k];
          if (type === 'number' || type === 'string' || type === 'boolean') {
            res[k] = `${oldState[k]} => ${newState[k] === '' ? '""' : newState[k]}`;
          } else if ((oldValue && oldValue.length) || (newValue && newValue.length)) {
            if (oldValue == null) {
              res[k] = `was null, now contains ${newValue.length} elements`;
            } else if (newValue == null) {
              res[k] = `contained ${oldValue.length} elements, now is null`;
            } else if (oldValue.length === 0) {
              res[k] = `was empty, now contains ${newValue.length} elements`;
            } else if (newValue.length === 0) {
              res[k] = `contained ${oldValue.length} elements, now is empty`;
            } else {
              let addedValues = newValue.filter((a: any) => !oldValue.find((b: any) => isEqual(a, b)));
              let removedValues = oldValue.filter((a: any) => !newValue.find((b: any) => isEqual(a, b)));

              if (addedValues.length > 10) {
                addedValues = `${addedValues.length} elements added`;
              }
              if (removedValues.length > 10) {
                removedValues = `${removedValues.length} elements removed`;
              }
              res[k] = {
                added: addedValues,
                removed: removedValues,
              };
            }
          } else {
            res[k] = newState[k];
          }
        }
      } else {
        res[k] = 'was deleted';
      }
    });

    Object.keys(newState).forEach((k) => {
      if (!oldState.hasOwnProperty(k)) {
        res[k] = `${newState[k]}`;
      }
    });
  }

  return res;
}

export function logStateChange<S>(
  name: string,
  logEnabled: boolean,
  oldState: S,
  newState: S,
  args: any[],
  source: string,
  failed = false
) {
  if (process.env.NODE_ENV === 'development' && logEnabled) {
    if (newState === null) {
      return null;
    }
    console.group(`[StateDecorator] Action ${name} ${source || ''} ${failed ? 'FAILED' : ''}`);
    if (Object.keys(args).length > 0) {
      console.group('Arguments');
      Object.keys(args).forEach((prop) => console.log(prop, ':', args[prop]));
      console.groupEnd();
    }
    console.groupCollapsed('Before');
    Object.keys(oldState).forEach((prop) => console.log(prop, ':', oldState[prop]));
    console.groupEnd();

    console.groupCollapsed('After');
    Object.keys(newState).forEach((prop) => console.log(prop, ':', newState[prop]));
    console.groupEnd();

    console.group('Diff');
    const diff = buildDiff(oldState, newState);
    Object.keys(diff).forEach((prop) => console.log(prop, ':', diff[prop]));
    console.groupEnd();

    console.groupEnd();
  }
}

export function logSingle(name: string, args: any[], logEnabled: boolean, state: string = '') {
  if (process.env.NODE_ENV === 'development' && logEnabled) {
    console.group(`[StateDecorator] Action ${name} ${state}`);
    if (Object.keys(args).length > 0) {
      console.group('Arguments');
      Object.keys(args).forEach((prop) => console.log(prop, ':', args[prop]));
      console.groupEnd();
    }
    console.groupEnd();
  }
}