////////////////////////////////////////////////////////////////////
// Enumeration
//
// Depth-first enumeration of all the paths through the computation.
// Q is the queue object to use. It should have enq, deq, and size methods.

'use strict';

var _ = require('underscore');
var PriorityQueue = require('priorityqueuejs');
var erp = require('../erp.js');


module.exports = function(env) {

  function Enumerate(store, k, a, wpplFn, maxExecutions, Q) {
    this.score = 0; // Used to track the score of the path currently being explored
    this.marginal = {}; // We will accumulate the marginal distribution here
    this.numCompletedExecutions = 0;
    this.store = store; // will be reinstated at the end
    this.k = k;
    this.a = a;
    this.wpplFn = wpplFn;
    this.maxExecutions = maxExecutions || Infinity;

    // Queue of states that we have yet to explore.  This queue is a
    // bunch of computation states. Each state is a continuation, a
    // value to apply it to, and a score.
    this.queue = Q;

    // Move old coroutine out of the way
    // and install this as the current handler
    this.coroutine = env.coroutine;
    env.coroutine = this;
  }

  Enumerate.prototype.run = function() {
    // Run the wppl computation, when the computation returns we want it
    // to call the exit method of this coroutine so we pass that as the
    // continuation.
    return this.wpplFn(this.store, env.exit, this.a);
  };

  Enumerate.prototype.nextInQueue = function() {
    var nextState = this.queue.deq();
    this.score = nextState.score;
    return nextState.continuation(nextState.store, nextState.value);
  };

  Enumerate.prototype.sample = function(store, cc, a, dist, params, extraScoreFn) {

    // Allows extra factors to be taken into account in making exploration decisions:
    extraScoreFn = extraScoreFn || function(x) {
      return 0;
    };

    // Find support of this erp:
    if (!dist.support) {
      console.error(dist, params);
      throw 'Enumerate can only be used with ERPs that have support function.';
    }
    var supp = dist.support(params);

    // Check that support is non-empty
    if (supp.length === 0) {
      console.error(dist, params);
      throw 'Enumerate encountered ERP with empty support!';
    }

    // For each value in support, add the continuation paired with
    // support value and score to queue:
    for (var s in supp) {
      if (supp.hasOwnProperty(s)) {
        var state = {
          continuation: cc,
          value: supp[s],
          score: this.score + dist.score(params, supp[s]) + extraScoreFn(supp[s]),
          store: _.clone(store)
        };
        this.queue.enq(state);
      }
    }
    // Call the next state on the queue
    return this.nextInQueue();
  };

  Enumerate.prototype.factor = function(s, cc, a, score) {
    // Update score and continue
    this.score += score;
    return cc(s);
  };

  // FIXME: can only call scoreFn in tail position!
  // Enumerate.prototype.sampleWithFactor = function(s,cc,a,dist,params,scoreFn) {
  //   coroutine.sample(s,cc,a,dist,params,
  //                    function(v){
  //                      var ret;
  //                      scoreFn(s, function(s, x){ret = x;}, a+"swf", v);
  //                      return ret;});
  // };


  Enumerate.prototype.exit = function(s, retval) {
    // We have reached an exit of the computation. Accumulate probability into retval bin.
    var r = JSON.stringify(retval);
    if (this.score !== -Infinity) {
      if (this.marginal[r] === undefined) {
        this.marginal[r] = {prob: 0, val: retval};
      }
      this.marginal[r].prob += Math.exp(this.score);
    }

    // Increment the completed execution counter
    this.numCompletedExecutions++;

    // If anything is left in queue do it:
    if (this.queue.size() > 0 && (this.numCompletedExecutions < this.maxExecutions)) {
      return this.nextInQueue();
    } else {
      var marginal = this.marginal;
      var dist = erp.makeMarginalERP(marginal);
      // Reinstate previous coroutine:
      env.coroutine = this.coroutine;
      // Return from enumeration by calling original continuation with original store:
      return this.k(this.store, dist);
    }
  };

  //helper wraps with 'new' to make a new copy of Enumerate and set 'this' correctly..
  function enuPriority(s, cc, a, wpplFn, maxExecutions) {
    var q = new PriorityQueue(function(a, b) {
      return a.score - b.score;
    });
    return new Enumerate(s, cc, a, wpplFn, maxExecutions, q).run();
  }

  function enuFilo(s, cc, a, wpplFn, maxExecutions) {
    var q = [];
    q.size = function() {
      return q.length;
    };
    q.enq = q.push;
    q.deq = q.pop;
    return new Enumerate(s, cc, a, wpplFn, maxExecutions, q).run();
  }

  function enuFifo(s, cc, a, wpplFn, maxExecutions) {
    var q = [];
    q.size = function() {
      return q.length;
    };
    q.enq = q.push;
    q.deq = q.shift;
    return new Enumerate(s, cc, a, wpplFn, maxExecutions, q).run();
  }

  return {
    Enumerate: enuPriority,
    EnumerateBreadthFirst: enuFifo,
    EnumerateDepthFirst: enuFilo,
    EnumerateLikelyFirst: enuPriority
  };

};
