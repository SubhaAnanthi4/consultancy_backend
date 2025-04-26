const mongoose = require('mongoose');

// Schema for dispatched materials
const MaterialDispatchSchema = new mongoose.Schema({
  materialName: {
    type: String,
    required: true,
  },
  toCompany: {
    type: String,
    required: true,
  },
  givenQuantity: {
    type: Number,
    required: true,
  },
  dispatchDate: {
    type: Date,
    default: Date.now,
  },
  wastage: {
    type: String, // storing percentage as a string like "12.34"
    default: "0.00",
  }
});

// Schema for received batches from companies
const BatchReturnSchema = new mongoose.Schema({
  materialId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MaterialDispatch',
    required: true,
  },
  receivedQuantity: {
    type: Number,
    required: true,
  },
  receivedDate: {
    type: Date,
    default: Date.now,
  }
});

const MaterialDispatch = mongoose.model('MaterialDispatch', MaterialDispatchSchema);
const BatchReturn = mongoose.model('BatchReturn', BatchReturnSchema);

module.exports = {
  MaterialDispatch,
  BatchReturn
};
