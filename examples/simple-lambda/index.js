/**
 * Example Lambda function
 * This is a simple Lambda that responds with a greeting message
 */

exports.handler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  const name = event.queryStringParameters?.name || event.name || 'World';

  const response = {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Hello, ${name}!`,
      timestamp: new Date().toISOString(),
      deployedBy: 'GitHub Lambda Deployer',
    }),
  };

  return response;
};
