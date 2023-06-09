const AWS = require("aws-sdk");
const { guid } = require("../etc/helpers.js");

AWS.config.update({
  region: "us-west-2",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});


const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

class ApiKeyManager {
  constructor(databasePath) {
    this.databasePath = databasePath;
    this.db = null;
    this.onready = () => {};
    this.ready = false;
    this.initializeDatabase()
      .then((db) => {
        this.db = db;
        this.onready(this.db);
        this.scheduleExpiredKeysDeletion();
      })
      .catch((err) => {
        console.log(err);
      });
  }

  async initializeDatabase() {
    try {
      const db = await open({
        filename: this.databasePath,
        driver: sqlite3.Database,
      });
      await db.run(`
        CREATE TABLE IF NOT EXISTS api_keys (
          api_key TEXT PRIMARY KEY,
          expiredAt INTEGER,
          uid TEXT,
          isBot BOOLEAN,
          linkedAccount TEXT NULL
        )
      `);
      console.log('Database initialized successfully.');
      return db;
    } catch (err) {
      console.error('Error initializing database:', err);
      
    }
  }

  async addKey(apiKey, expiredAt, uid) {
    try {
      await this.db.run(
        `
        INSERT INTO api_keys (api_key, expiredAt, uid, isBot, linkedAccount)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(api_key) DO UPDATE SET expiredAt = excluded.expiredAt, uid = excluded.uid
        `,
        [apiKey, expiredAt, uid, 0, null]
      );
    } catch (err) {
      console.error('Error adding API key:', err);
    }
  }
  async createBot(linkedAccount, key, uid){
    try{
    await this.db.run(
      `
      INSERT INTO api_keys (api_key, expiredAt, uid, isBot, linkedAccount)
      VALUES (?, ?, ?, ?, ?)
      `,
      [key, 0, uid, 1, linkedAccount]
    )
    }catch(err){
      console.error(err);
    }
  }
  async updateUid(apiKey, uid) {
    try {
      await this.db.run(`UPDATE api_keys SET uid = ? WHERE api_key = ?`, [uid, apiKey]);
    } catch (err) {
      console.error('Error updating UID:', err);
    }
  }

  async deleteKey(apiKey) {
    try {
      await this.db.run(`DELETE FROM api_keys WHERE api_key = ?`, [apiKey]);
      console.log('API key deleted successfully.');
    } catch (err) {
      console.error('Error deleting API key:', err);
    }
  }

  async isKeyExpired(apiKey) {
    try {
      const row = await this.db.get(`SELECT expiredAt FROM api_keys WHERE api_key = ?`, [apiKey]);
      const currentTime = new Date().getTime();
      const expiredAt = row && row.expiredAt ? row.expiredAt : 0;

      return expiredAt > 0 && expiredAt < currentTime;
    } catch (err) {
      console.error('Error checking expiration status:', err);
    }
  }
  async getAPIKeysForUid(uid){
    try{
      const rows = await this.db.all(`SELECT api_key FROM api_keys WHERE uid = ?`,[uid]);
      return rows;
    }catch(err){
      console.error(err)
    }
  }
  async getAPIKey(apiKey) {
    try {
      const row = await this.db.get(`SELECT * FROM api_keys WHERE api_key = ?`, [apiKey]);
      if (!row) {
        return false;
      } else {
        return row;
      }
    } catch (err) {
      console.error('Error retrieving API key:', err);
      
    }
  }

  async deleteExpiredKeys() {
    try {
      await this.db.run('DELETE FROM api_keys WHERE expiredAt < ? AND isBot = ?', [Date.now(),0]);
      console.log('Expired API keys deleted successfully.');
    } catch (err) {
      console.error('Error deleting expired API keys:', err);
      
    }
  }

  scheduleExpiredKeysDeletion() {
    this.deleteExpiredKeys();
    setInterval(() => {
      if (this.ready) {
        this.deleteExpiredKeys();
      }
    }, 60 * 60 * 1000); // Run every hour (in milliseconds)
  }
}

const apiKeyManager = new ApiKeyManager('api_keys.db');
apiKeyManager.onready =async (db) => {
  apiKeyManager.ready = true;
};




class DBManager{
  constructor(){
    this.TABLE_NAME = "multisnake";
    const DynamoDB = new AWS.DynamoDB();
    this.dynamoClient = new AWS.DynamoDB.DocumentClient();
    this.schema = {
      "uid":"string",
      "username":"string",
      "email":"string",
      "gamesPlayed":"Integer",
      "gamesWon":"Integer",
      "passwordHash":"string",
      "verified":"boolean",
      "yearBorn":"Integer",
      "api_keys":"String[]"
    }
  }
  async winGame(uid, timeToWin) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      },
      UpdateExpression: "SET gamesWon = gamesWon + :incr",
      ExpressionAttributeValues: {
        ":incr": 1,
      }
    };
  
    try {
      const data = await this.dynamoClient.update(params).promise();
      return data;
    } catch (err) {
      console.log(err);
    }
  }
  
  async playGame(uid) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      },
      UpdateExpression: "SET gamesPlayed = gamesPlayed + :incr",
      ExpressionAttributeValues: {
        ":incr": 1
      }
    };
  
    try {
      const data = await this.dynamoClient.update(params).promise();
      return data;
    } catch (err) {
      console.log(err);
    }
  }
  
  async createUser(email,username,passwordHash,verified,age){
    const params = {
      TableName: this.TABLE_NAME,
      Item: {
        uid: guid(),
        username,
        email,
        gamesPlayed: 0,
        gamesWon: 0,
        fastestTimeToWin: Number.MAX_SAFE_INTEGER,
        passwordHash,
        verified,
        yearBorn: age,
        timestamp: new Date().getTime()
      }
    }
    try {
      const data = await this.dynamoClient.put(params).promise();
      return data
    } catch (err){
      console.log(err);
    }
  }
  async setVerified(uid) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      },
      UpdateExpression: "SET #v = :val",
      ExpressionAttributeNames: {
        "#v": "verified"
      },
      ExpressionAttributeValues: {
        ":val": true
      }
    };
  
    try {
      const data = await this.dynamoClient.update(params).promise();
      return data;
    } catch (err) {
      console.log(err);
    }
  }
  async updateUsername(uid, newUsername) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      },
      UpdateExpression: "SET #un = :username",
      ExpressionAttributeNames: {
        "#un": "username"
      },
      ExpressionAttributeValues: {
        ":username": newUsername
      }
    };
  
    try {
      const data = await this.dynamoClient.update(params).promise();
      return data;
    } catch (err) {
      console.log(err);
    }
  }
  async deleteUser(uid) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      }
    };
  
    try {
      const data = await this.dynamoClient.delete(params).promise();
      return data;
    } catch (err) {
      console.log(err);
    }
  }
  async isOldEnough(uid) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      },
      ProjectionExpression: "yearBorn"
    };
  
    try {
      const data = await this.dynamoClient.get(params).promise();
      const userAge = data.Item.yearBorn;
      return new Date().getFullYear() - userAge > 13;
    } catch (err) {
      console.log(err);
    }
  }
  async isVerified(uid) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      },
      ProjectionExpression: "verified"
    };
  
    try {
      const data = await this.dynamoClient.get(params).promise();
      const isVerified = data.Item.verified;
      return isVerified === true;
    } catch (err) {
      console.log(err);
    }
  }
  async updatePassword(uid, newPasswordHash) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      },
      UpdateExpression: "SET #pw = :password",
      ExpressionAttributeNames: {
        "#pw": "passwordHash"
      },
      ExpressionAttributeValues: {
        ":password": newPasswordHash
      }
    };
  
    try {
      const data = await this.dynamoClient.update(params).promise();
      return data;
    } catch (err) {
      console.log(err);
    }
  }
      
  async getDataByEmail(email){
    const params = {
      TableName: this.TABLE_NAME,
      IndexName: "email-index",
      ExpressionAttributeValues: {
        ":e": email
      },
      KeyConditionExpression: "email = :e"
    };
    try {
      const data = await this.dynamoClient.query(params).promise();
      return data;
    } catch (err) {
      console.log(err);
    }
  }
  async getUser(uid) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      }
    };
  
    try {
      const data = await this.dynamoClient.get(params).promise();
      return data.Item;
    } catch (err) {
      console.log(err);
    }
  }
  async addAPIKey(uid, apiKey, botUid) {
    const params = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      },
      UpdateExpression: "SET #ak = list_append(if_not_exists(#ak, :empty_list), :apiKey)",
      ExpressionAttributeNames: {
        "#ak": "api_keys"
      },
      ExpressionAttributeValues: {
        ":empty_list": [],
        ":apiKey": [
          {
            apiKey,
            botUid
          }
        ]
      }
    };
  
    try {
      const data = await this.dynamoClient.update(params).promise();
      return data;
    } catch (err) {
      console.log(err);
    }
  }
  
  async removeAPIKey(uid, apiKey) {
    const getParams = {
      TableName: this.TABLE_NAME,
      Key: {
        uid
      }
    };
  
    try {
      let data = await this.dynamoClient.get(getParams).promise();
      const apiKeys = data.Item.api_keys || [];
  
      // Remove the apiKey from the list
      const updatedKeys = apiKeys.filter(key => key.apiKey !== apiKey);
  
      const updateParams = {
        TableName: this.TABLE_NAME,
        Key: {
          uid
        },
        UpdateExpression: "SET #ak = :updatedKeys",
        ExpressionAttributeNames: {
          "#ak": "api_keys"
        },
        ExpressionAttributeValues: {
          ":updatedKeys": updatedKeys
        },
        ReturnValues: "UPDATED_NEW"
      };
  
      // Update the item with the modified list
      data = await this.dynamoClient.update(updateParams).promise();
      return data;
    } catch (err) {
      console.log(err);
    }
  }
  
  
  async sendVerification(email, code) {
    const params = {
      Destination: {
        ToAddresses: [email]
      },
      Message: {
        Body: {
          Html: {
            Charset: "UTF-8",
            Data: "<h1>Hello " + email + "</h1><p>Your Multisnake V2 verification code is " + code + "</p>"
          },
          Text: {
            Charset: "UTF-8",
            Data: "Hello " + email + "\n. Your Multisnake V2 verification code is" + code
          }
        },
        Subject: {
          Charset: "UTF-8",
          Data: "[Multisnake V2] Verification Code"
        }
      },
      Source: "sojscoder@gmail.com",
      ReplyToAddresses: [
        "sojscoder@gmail.com"
      ]
    };
    var sendPromise = new AWS.SES({
      apiVersion: '2010-12-01'
    }).sendEmail(params).promise();
    sendPromise.then(function(data) {}).catch(function(err) {console.error(err, err.stack);});
  }
}


const dbManager = new DBManager();
module.exports = {
  apiKeyManager,
  dbManager
}